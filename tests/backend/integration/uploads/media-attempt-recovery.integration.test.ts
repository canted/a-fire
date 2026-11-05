import "reflect-metadata"
import { PrismaClient } from "@prisma/client"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { build } from "esbuild"
import { parseRecoverMediaAttemptArgs } from "@server/runtime/recoverMediaAttempt"
import { it, expect, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"
import { beginMediaProcessing, recoverMediaProcessing, publishMediaProcessing } from "@server/uploads/media-processing"

it.each(["audio", "video"] as const)("recovers interrupted %s atomically and fences late writers across copies", async kind => {
  const prisma = new PrismaService(), boss = new BossService(), now = new Date(), token = crypto.randomUUID()
  const user = await prisma.user.create({ data: { email: `${token}@attempt-recovery.test`, username: "Recovery", created_at: now, updated_at: now } })
  const blob = await prisma.activeStorageBlob.create({ data: { key: token, filename: "source", byte_size: 1, service_name: "test", created_at: now } })
  const queue = kind === "audio" ? "uploads.audio" : "uploads.video"
  const assets = []
  const payload = (id: number) => kind === "audio" ? { audioAssetId: id } : { videoAssetId: id }
  try {
    for (let i = 0; i < 2; i++) {
      const data = { blob_id: blob.id, owner_id: user.id, source_type: "User", source_id: user.id, title: "Copy", original_filename: "source", processing_status: "pending", created_at: now, updated_at: now }
      assets.push(kind === "audio" ? await prisma.audioAsset.create({ data }) : await prisma.videoAsset.create({ data }))
    }
    const old = await beginMediaProcessing(prisma, blob.id, kind)
    const before = new Date(Date.now() + 1000)
    const bundle = await build({ entryPoints: ["server/scripts/recover-media-attempt.ts"], bundle: true, write: false, platform: "node", format: "esm", packages: "external" })
    const run = async (id: string, execute = false, database = process.env.DATABASE_URL!) => {
      const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", bundle.outputFiles[0].text, "recover-media-attempt", "--attempt-id", id, "--before", new Date(Date.now() + 1000).toISOString(), ...(execute ? ["--execute"] : [])], {
        env: { ...process.env, NODE_ENV: "production", DATABASE_URL: database }, timeout: 10000,
      })
      return JSON.parse(result.stdout.trim())
    }
    const readOnlyUrl = new URL(process.env.DATABASE_URL!)
    readOnlyUrl.searchParams.set("options", "-c default_transaction_read_only=on")
    const readOnlyProbe = new PrismaClient({ datasources: { db: { url: readOnlyUrl.toString() } } })
    try { expect(await readOnlyProbe.$queryRaw`SELECT current_setting('transaction_read_only') AS mode`).toEqual([{ mode: "on" }]) }
    finally { await readOnlyProbe.$disconnect() }
    expect(await run(old.id, false, readOnlyUrl.toString())).toMatchObject({ dry_run: true, outcome: "preview", recovery: false, attempt: { id: old.id, state: "processing", writer_status: "unknown" } })
    expect(await run(crypto.randomUUID(), false, readOnlyUrl.toString())).toMatchObject({ outcome: "not_found", attempt: null })
    await boss.start()
    expect(await recoverMediaProcessing(prisma, boss, old.id, new Date(0))).toBe(false)
    const job = await boss.enqueue(queue, payload(assets[1].id))
    for (const state of ["created", "retry", "active"]) {
      await prisma.$executeRaw`UPDATE pgboss.job SET state = ${state}::pgboss.job_state WHERE id = ${job}::uuid`
      expect(await recoverMediaProcessing(prisma, boss, old.id, before)).toBe(false)
    }
    await prisma.$executeRaw`UPDATE pgboss.job SET state = 'failed' WHERE id = ${job}::uuid`
    const enqueue = boss.enqueueInTransaction.bind(boss)
    let rolledBackJob: string | undefined
    const failure = vi.spyOn(boss, "enqueueInTransaction").mockImplementation(async (...args) => {
      rolledBackJob = await enqueue(...args)
      throw new Error("Recovery enqueue failed")
    })
    await expect(recoverMediaProcessing(prisma, boss, old.id, before)).rejects.toThrow("Recovery enqueue failed")
    failure.mockRestore()
    expect((await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })).media_generation).toBe(old.generation)
    expect((await prisma.mediaProcessingAttempt.findUniqueOrThrow({ where: { id: old.id } })).state).toBe("processing")
    expect(await prisma.$queryRaw`SELECT id FROM pgboss.job WHERE id = ${rolledBackJob}::uuid`).toEqual([])
    const recovered = await Promise.all(Array.from({ length: 6 }, () => recoverMediaProcessing(prisma, boss, old.id, before)))
    expect(recovered.filter(Boolean)).toHaveLength(1)
    const fenced = await prisma.mediaProcessingAttempt.findUniqueOrThrow({ where: { id: old.id } })
    expect(fenced).toMatchObject({ state: "superseded", finished_at: null })
    const pending = kind === "audio" ? await prisma.audioAsset.findMany({ where: { blob_id: blob.id } }) : await prisma.videoAsset.findMany({ where: { blob_id: blob.id } })
    expect(pending.map(asset => asset.processing_status)).toEqual(["pending", "pending"])
    const output = { filename: "playback", contentType: `${kind}/mp4`, byteSize: 2, metadata: null, durationMs: 1000 }
    expect(await publishMediaProcessing(prisma, old.id, output)).toBe(false)
    expect((await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })).key).toBe(token)
    const replacement = await beginMediaProcessing(prisma, blob.id, kind)
    expect(replacement.sourceKey).toBe(token)
    expect(replacement.generation).toBeGreaterThan(old.generation)
    expect(await publishMediaProcessing(prisma, replacement.id, output)).toBe(true)
    const ready = kind === "audio" ? await prisma.audioAsset.findMany({ where: { blob_id: blob.id } }) : await prisma.videoAsset.findMany({ where: { blob_id: blob.id } })
    expect(ready.map(asset => asset.processing_status)).toEqual(["ready", "ready"])
    expect(await recoverMediaProcessing(prisma, boss, replacement.id, before)).toBe(false)
    for (const asset of assets) await prisma.$executeRaw`UPDATE pgboss.job SET state = 'completed' WHERE name = ${queue} AND data @> ${JSON.stringify(payload(asset.id))}::jsonb`
    const interrupted = await beginMediaProcessing(prisma, blob.id, kind)
    expect(await run(interrupted.id, true)).toMatchObject({ dry_run: false, outcome: "enqueued", recovery: { blobId: blob.id, assetId: assets[0].id } })
    expect(await run(interrupted.id, true)).toMatchObject({ dry_run: false, outcome: "skipped", recovery: false })
  } finally {
    vi.restoreAllMocks()
    await boss.onModuleDestroy()
    for (const asset of assets) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name = ${queue} AND data @> ${JSON.stringify(payload(asset.id))}::jsonb`
    await prisma.activeStorageBlob.delete({ where: { id: blob.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})


it.each([[], ["--execute"], ["--attempt-id", "bad", "--before", "2026-01-01"], ["--attempt-id", "00000000-0000-0000-0000-000000000001"], ["--attempt-id", "00000000-0000-0000-0000-000000000001", "--before", "bad"], ["--unknown", "value"]].map(args => ({ args })))("rejects incomplete recovery arguments $args", ({ args }) => {
  expect(() => parseRecoverMediaAttemptArgs(args)).toThrow()
})
