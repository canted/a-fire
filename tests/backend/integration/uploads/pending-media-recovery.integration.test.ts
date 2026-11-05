import "reflect-metadata"
import { it, expect, vi } from "vitest"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { build } from "esbuild"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"
import { beginMediaProcessing, recoverPendingMedia } from "@server/uploads/media-processing"
import { parseRecoverPendingMediaArgs, previewPendingMediaRecovery } from "@server/runtime/recoverPendingMedia"

it.each(["audio", "video"] as const)("recovers pending %s once across copies and rolls back failed enqueue", async kind => {
  const prisma = new PrismaService(), boss = new BossService(), now = new Date(), old = new Date("2000-01-01")
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@pending-recovery.test`, username: "Fixture", created_at: now, updated_at: now } })
  const blob = await prisma.activeStorageBlob.create({ data: { key: crypto.randomUUID(), filename: "source", byte_size: 1, service_name: "test", created_at: now } })
  const assets: Array<{ id: number }> = []
  const queue = kind === "audio" ? "uploads.audio" : "uploads.video"
  const payload = (id: number) => kind === "audio" ? { audioAssetId: id } : { videoAssetId: id }
  const before = new Date(Date.now() + 60000)
  try {
    for (let index = 0; index < 2; index++) {
      const data = { blob_id: blob.id, owner_id: user.id, source_type: "User", source_id: user.id, title: "private", original_filename: "source", processing_status: "pending", error_message: "old", created_at: old, updated_at: old }
      assets.push(kind === "audio" ? await prisma.audioAsset.create({ data }) : await prisma.videoAsset.create({ data }))
    }
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
      expect(await previewPendingMediaRecovery(tx as unknown as PrismaService, kind, assets[0].id)).toMatchObject({ id: assets[0].id, processing_status: "pending" })
    })
    const bundle = await build({ entryPoints: ["server/scripts/recover-pending-media.ts"], bundle: true, write: false, platform: "node", format: "esm", packages: "external" })
    const readOnly = new URL(process.env.DATABASE_URL!)
    readOnly.searchParams.set("options", "-c default_transaction_read_only=on")
    const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", bundle.outputFiles[0].text, "recover-pending-media", "--kind", kind, "--asset-id", String(assets[0].id), "--before", before.toISOString()], {
      env: { ...process.env, NODE_ENV: "production", DATABASE_URL: readOnly.toString() }, timeout: 10000,
    })
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ dry_run: true, outcome: "preview", recovery: false, asset: { id: assets[0].id } })
    await boss.start()
    expect(await recoverPendingMedia(prisma, boss, kind, assets[0].id, new Date(0))).toBe(false)
    const existing = await boss.enqueue(queue, payload(assets[1].id))
    for (const state of ["created", "retry", "active"]) {
      await prisma.$executeRaw`UPDATE pgboss.job SET state=${state}::pgboss.job_state WHERE id=${existing}::uuid`
      expect(await recoverPendingMedia(prisma, boss, kind, assets[0].id, before)).toBe(false)
    }
    await prisma.$executeRaw`UPDATE pgboss.job SET state='failed' WHERE id=${existing}::uuid`
    const enqueue = boss.enqueueInTransaction.bind(boss)
    let rolledBack: string | undefined
    const injected = vi.spyOn(boss, "enqueueInTransaction").mockImplementation(async (...args) => {
      rolledBack = await enqueue(...args)
      throw new Error("injected pending enqueue failure")
    })
    await expect(recoverPendingMedia(prisma, boss, kind, assets[0].id, before)).rejects.toThrow("injected pending enqueue failure")
    injected.mockRestore()
    expect(await prisma.$queryRaw`SELECT id FROM pgboss.job WHERE id=${rolledBack}::uuid`).toEqual([])
    expect(await previewPendingMediaRecovery(prisma, kind, assets[0].id)).toMatchObject({ updated_at: old })
    const outcomes = await Promise.all(Array.from({ length: 6 }, (_, index) => recoverPendingMedia(prisma, boss, kind, assets[index % 2].id, before)))
    expect(outcomes.filter(Boolean)).toHaveLength(1)
    expect(await prisma.mediaProcessingAttempt.count({ where: { blob_id: blob.id } })).toBe(0)
    expect(await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })).toEqual(blob)
    for (const asset of assets) await prisma.$executeRaw`UPDATE pgboss.job SET state='completed' WHERE name=${queue} AND data @> ${JSON.stringify(payload(asset.id))}::jsonb`
    const setStatus = async (processing_status: string) => {
      const update = { where: { id: assets[1].id }, data: { processing_status } }
      if (kind === "audio") await prisma.audioAsset.update(update); else await prisma.videoAsset.update(update)
    }
    await setStatus("ready")
    expect(await recoverPendingMedia(prisma, boss, kind, assets[0].id, before)).toBe(false)
    await setStatus("pending")
    const attempt = await beginMediaProcessing(prisma, blob.id, kind)
    const update = { where: { blob_id: blob.id }, data: { processing_status: "pending" } }
    if (kind === "audio") await prisma.audioAsset.updateMany(update); else await prisma.videoAsset.updateMany(update)
    expect(await recoverPendingMedia(prisma, boss, kind, assets[0].id, before)).toBe(false)
    expect((await prisma.mediaProcessingAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).state).toBe("processing")
  } finally {
    vi.restoreAllMocks()
    await boss.onModuleDestroy()
    for (const asset of assets) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name=${queue} AND data @> ${JSON.stringify(payload(asset.id))}::jsonb`
    await prisma.activeStorageBlob.delete({ where: { id: blob.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
}, 20000)

it.each([[], ["--execute"], ["--kind", "image"], ["--kind", "audio", "--asset-id", "0", "--before", "2026-01-01"], ["--kind", "audio", "--asset-id", "1", "--before", "bad"]].map(args => ({ args })))("rejects incomplete recovery $args", ({ args }) => {
  expect(() => parseRecoverPendingMediaArgs(args)).toThrow()
})
