import { videoPosterStorageKey } from "@server/uploads/video/video-poster"
import "reflect-metadata"
import { execFile, spawn, type ChildProcess } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { promisify } from "node:util"
import os from "node:os"
import path from "node:path"
import { build } from "esbuild"
import type PgBoss from "pg-boss"
import { it, expect, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"
import { StorageService } from "@server/storage/storage.service"
import { AudioProcessor } from "@server/uploads/audio/audio.processor"
import { VideoProcessor } from "@server/uploads/video/video.processor"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each([
  { kind: "audio", stage: "before-publication" }, { kind: "audio", stage: "after-publication" },
  { kind: "video", stage: "before-publication" }, { kind: "video", stage: "after-publication" },
] as const)("recovers $kind after SIGKILL $stage", async ({ kind, stage }) => {
  const prisma = new PrismaService(), boss = new BossService()
  const root = await mkdtemp(path.join(os.tmpdir(), "afire-media-crash-"))
  const storage = withTestDependencies(new StorageService(), { localRoot: root, useS3: false })
  const queue = `crash-media-${crypto.randomUUID()}`, now = new Date()
  let child: ChildProcess | undefined, exited: Promise<string | null> | undefined
  let userId: number | undefined, blobId: number | undefined
  try {
    const filename = kind === "audio" ? "source.wav" : "source.mov", input = path.join(root, filename)
    await promisify(execFile)("ffmpeg", kind === "audio"
      ? ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.1", input]
      : ["-y", "-f", "lavfi", "-i", "color=c=red:s=32x32:d=0.1", "-c:v", "libx264", "-pix_fmt", "yuv420p", input])
    const bytes = await readFile(input)
    const user = await prisma.user.create({ data: { email: `${queue}@test.invalid`, username: "Author", created_at: now, updated_at: now } })
    userId = user.id
    const blob = await prisma.activeStorageBlob.create({ data: { key: queue, filename, byte_size: bytes.length, content_type: kind === "audio" ? "audio/wav" : "video/quicktime", service_name: "test", created_at: now } })
    blobId = blob.id
    await storage.put(blob.key, bytes)
    const data = { blob_id: blob.id, owner_id: user.id, source_type: "User", source_id: user.id, title: "Crash", original_filename: filename, original_mime_type: blob.content_type, processing_status: "pending", created_at: now, updated_at: now }
    const asset = kind === "audio" ? await prisma.audioAsset.create({ data }) : await prisma.videoAsset.create({ data })
    const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
      import 'reflect-metadata';
      import { PrismaService } from './server/prisma/prisma.service';
      import { BossService } from './server/queue/boss.service';
      import { StorageService } from './server/storage/storage.service';
      import { AudioProcessor } from './server/uploads/audio/audio.processor';
      import { VideoProcessor } from './server/uploads/video/video.processor';
      const hold = async () => { console.log('checkpoint'); await new Promise(() => {}); };
      const prisma = new PrismaService().$extends({ query: { $allModels: { async updateMany({ args, query }) {
        if (process.env.CRASH_STAGE === 'before-publication' && args.data.processing_status === 'ready') await hold();
        return query(args);
      } } } });
      const storage = new StorageService(); storage.localRoot = process.env.CRASH_ROOT; storage.useS3 = false;
      const processor = process.env.CRASH_KIND === 'audio' ? new AudioProcessor() : new VideoProcessor();
      processor.prisma = prisma; processor.storage = storage;
      const boss = new BossService();
      boss.work(process.env.CRASH_QUEUE, async data => {
        await processor.process(process.env.CRASH_KIND === 'audio' ? { audioAssetId: data.id } : { videoAssetId: data.id });
        await hold();
      }).catch(error => { console.error(error); process.exit(1); });
    ` }, bundle: true, write: false, platform: "node", format: "esm", packages: "external", external: ["@tiptap/*"] })
    await boss.start()
    const client = (boss as unknown as { boss: PgBoss }).boss
    await client.createQueue(queue)
    const id = await boss.enqueue(queue, { id: asset.id })
    child = spawn(process.execPath, ["--input-type=module", "-e", bundle.outputFiles[0].text], { env: { ...process.env, CRASH_STAGE: stage, CRASH_KIND: kind, CRASH_QUEUE: queue, CRASH_ROOT: root }, stdio: ["ignore", "pipe", "pipe"] })
    let output = "", errors = ""
    child.stdout!.on("data", chunk => { output += String(chunk) })
    child.stderr!.on("data", chunk => { errors += String(chunk) })
    exited = new Promise((resolve, reject) => { child!.once("error", reject); child!.once("exit", (_code, signal) => resolve(signal)) })
    await vi.waitFor(() => expect(output, errors).toContain("checkpoint"), { timeout: 10000 })
    child.kill("SIGKILL")
    expect(await exited).toBe("SIGKILL")
    const interrupted = await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })
    expect(interrupted.key === blob.key).toBe(stage === "before-publication")
    const first = await prisma.mediaProcessingAttempt.findFirstOrThrow({ where: { blob_id: blob.id } })
    expect(await storage.exists(first.output_key)).toBe(true)
    expect(first.finished_at === null).toBe(stage === "before-publication")
    const [active] = await prisma.$queryRaw<Array<{ state: string; retry_limit: number }>>`SELECT state::text, retry_limit FROM pgboss.job WHERE id = ${id}::uuid`
    expect(active).toMatchObject({ state: "active", retry_limit: 2 })
    // Advance only this fixture job's clock, preserving installed Boss retry/expiry defaults.
    await prisma.$executeRaw`UPDATE pgboss.job SET started_on = now() - expire_in - interval '1 second' WHERE id = ${id}::uuid`
    await client.maintain()
    const audio = withTestDependencies(new AudioProcessor(), { prisma, storage })
    const video = withTestDependencies(new VideoProcessor(), { prisma, storage })
    await boss.work<{ id: number }>(queue, job => kind === "audio"
      ? audio.process({ audioAssetId: job.id })
      : video.process({ videoAssetId: job.id }))
    await vi.waitFor(async () => {
      const [job] = await prisma.$queryRaw<Array<{ state: string; retry_count: number }>>`SELECT state::text, retry_count FROM pgboss.job WHERE id = ${id}::uuid`
      expect(job).toMatchObject({ state: "completed", retry_count: 1 })
    }, { timeout: 10000 })
    const recovered = await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })
    expect(recovered).toMatchObject({ media_source_key: blob.key, media_generation: 2 })
    expect(recovered.key).not.toBe(first.output_key)
    expect(await storage.getBuffer(blob.key)).toEqual(bytes)
    expect((await storage.getBuffer(recovered.key)).length).toBeGreaterThan(0)
    if (kind === "video") expect((await storage.getBuffer(videoPosterStorageKey(recovered.key))).length).toBeGreaterThan(0)
    const retained = await prisma.mediaProcessingAttempt.findUniqueOrThrow({ where: { id: first.id } })
    expect(retained.finished_at === null).toBe(stage === "before-publication")
    const saved = kind === "audio" ? await prisma.audioAsset.findUniqueOrThrow({ where: { id: asset.id } }) : await prisma.videoAsset.findUniqueOrThrow({ where: { id: asset.id } })
    expect(saved).toMatchObject({ blob_id: blob.id, processing_status: "ready", error_message: null })
    expect(await prisma.mediaProcessingAttempt.count({ where: { blob_id: blob.id } })).toBe(2)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    await exited
    await boss.onModuleDestroy()
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name = ${queue}`
    await prisma.$executeRaw`DELETE FROM pgboss.queue WHERE name = ${queue}`
    if (blobId) await prisma.activeStorageBlob.delete({ where: { id: blobId } })
    if (userId) await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
