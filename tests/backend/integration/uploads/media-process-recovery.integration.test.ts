import "reflect-metadata"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { spawn, execFile, type ChildProcess } from "node:child_process"
import { promisify } from "node:util"
import { build } from "esbuild"
import { it, expect } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"
import { StorageService } from "@server/storage/storage.service"
import { recoverMediaProcessing } from "@server/uploads/media-processing"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each(["audio", "video"] as const)("recovers %s after SIGKILL between output upload and publication", async kind => {
  const prisma = new PrismaService(), boss = new BossService(), now = new Date(), token = crypto.randomUUID()
  const root = await mkdtemp(path.resolve("tmp/media-process-recovery-"))
  const storage = withTestDependencies(new StorageService(), { localRoot: path.join(root, "storage"), useS3: false })
  const user = await prisma.user.create({ data: { email: `${token}@process-recovery.test`, username: "Recovery", created_at: now, updated_at: now } })
  const blob = await prisma.activeStorageBlob.create({ data: { key: token, filename: `source.${kind === "audio" ? "wav" : "mov"}`, content_type: kind === "audio" ? "audio/wav" : "video/quicktime", byte_size: 8, service_name: "test", created_at: now } })
  const assets = []
  let child: ChildProcess | undefined, closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined
  let jobId: string | undefined
  try {
    await storage.put(token, Buffer.from("original"))
    for (let index = 0; index < 2; index++) {
      const data = { blob_id: blob.id, owner_id: user.id, source_type: "User", source_id: user.id, title: "Copy", original_filename: blob.filename, original_mime_type: blob.content_type, processing_status: "pending", created_at: now, updated_at: now }
      assets.push(kind === "audio" ? await prisma.audioAsset.create({ data }) : await prisma.videoAsset.create({ data }))
    }
    const bundle = await build({ entryPoints: ["tests/backend/fixtures/media-process-interruption.ts"], bundle: true, write: false, platform: "node", format: "esm", packages: "external" })
    const entry = path.join(root, "processor.mjs")
    await writeFile(entry, bundle.outputFiles[0].text)
    const childEnv = { ...process.env, TMPDIR: root, TMP: root, TEMP: root }
    child = spawn(process.execPath, [entry, path.join(root, "storage"), kind, String(assets[0].id), "interrupt"], { env: childEnv, stdio: ["ignore", "pipe", "pipe", "ipc"] })
    closed = new Promise((resolve, reject) => { child!.once("error", reject); child!.once("close", (code, signal) => resolve({ code, signal })) })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Processor did not reach upload boundary")), 10000)
      child!.once("message", message => { clearTimeout(timer); if ((message as { stage?: string }).stage === "output-written") resolve(); else reject(new Error("Unexpected processor boundary")) })
      void closed!.then(() => { clearTimeout(timer); reject(new Error("Processor exited before boundary")) }, reject)
    })
    const old = await prisma.mediaProcessingAttempt.findFirstOrThrow({ where: { blob_id: blob.id } })
    expect(old).toMatchObject({ state: "processing", finished_at: null })
    expect(await storage.getBuffer(old.output_key)).toEqual(Buffer.from("unfinished output"))
    expect(child.kill("SIGKILL")).toBe(true)
    expect(await closed).toEqual({ code: null, signal: "SIGKILL" })
    expect((await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })).key).toBe(token)
    await boss.start()
    const recovery = await recoverMediaProcessing(prisma, boss, old.id, new Date())
    expect(recovery).not.toBe(false)
    if (!recovery) throw new Error("Recovery was skipped")
    jobId = recovery.jobId
    const [queued] = await prisma.$queryRaw<Array<{ data: Record<string, number> }>>`SELECT data FROM pgboss.job WHERE id = ${jobId}::uuid`
    const assetId = kind === "audio" ? queued.data.audioAssetId : queued.data.videoAssetId
    await promisify(execFile)(process.execPath, [entry, path.join(root, "storage"), kind, String(assetId), "replace"], { env: childEnv, timeout: 15000 })
    const published = await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })
    expect(published.key).not.toBe(old.output_key)
    expect(await storage.getBuffer(published.key)).toEqual(Buffer.from("replacement output"))
    expect(await storage.getBuffer(token)).toEqual(Buffer.from("original"))
    expect(await storage.getBuffer(old.output_key)).toEqual(Buffer.from("unfinished output"))
    expect(await prisma.mediaProcessingAttempt.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ state: "superseded", finished_at: null })
    const copies = kind === "audio" ? await prisma.audioAsset.findMany({ where: { blob_id: blob.id } }) : await prisma.videoAsset.findMany({ where: { blob_id: blob.id } })
    expect(copies.map(asset => asset.processing_status)).toEqual(["ready", "ready"])
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    await closed
    await boss.onModuleDestroy()
    if (jobId) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE id = ${jobId}::uuid`
    await prisma.activeStorageBlob.delete({ where: { id: blob.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
