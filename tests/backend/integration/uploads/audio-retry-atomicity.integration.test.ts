import { PrismaClient } from "@prisma/client"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { build } from "esbuild"
import "reflect-metadata"
import { it, expect, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"
import { retryFailedMediaAssets } from "@server/runtime/retryFailedMedia"

// Includes bundling, a CLI with its own 10-second deadline, database assertions
// and cleanup. The default 5-second test budget can expire before that CLI bound.
it.each(["audio", "video"] as const)("rolls back failed recovery enqueue and claims concurrent %s retries once", async kind => {
  const prisma = new PrismaService()
  const boss = new BossService()
  const queue = kind === "audio" ? "uploads.audio" : "uploads.video"
  const retry = (options: Parameters<typeof retryFailedMediaAssets>[3]) => retryFailedMediaAssets(prisma, boss, kind, options)
  const now = new Date()
  const token = crypto.randomUUID()
  const user = await prisma.user.create({ data: { email: `${token}@retry.test`, username: "Recovery", created_at: now, updated_at: now } })
  const blob = await prisma.activeStorageBlob.create({ data: { key: token, filename: "test.wav", byte_size: 1, service_name: "test", created_at: now } })
  const assetInput = { data: { blob_id: blob.id, owner_id: user.id, source_type: "User", source_id: user.id, title: "Recovery", original_filename: "test.wav", processing_status: "failed", error_message: token, created_at: now, updated_at: now } }
  const asset = kind === "audio" ? await prisma.audioAsset.create(assetInput) : await prisma.videoAsset.create(assetInput)
  const readAsset = () => kind === "audio" ? prisma.audioAsset.findUnique({ where: { id: asset.id } }) : prisma.videoAsset.findUnique({ where: { id: asset.id } })
  const copyInput = { data: { ...assetInput.data, error_message: "Separate copy" } }
  const copy = kind === "audio" ? await prisma.audioAsset.create(copyInput) : await prisma.videoAsset.create(copyInput)
  const payload = kind === "audio" ? { audioAssetId: asset.id } : { videoAssetId: asset.id }
  const copyPayload = kind === "audio" ? { audioAssetId: copy.id } : { videoAssetId: copy.id }
  const ids: string[] = []
  let existingJob: string | null = null
  const enqueue = boss.enqueueInTransaction.bind(boss)
  let fail = true
  const spy = vi.spyOn(boss, "enqueueInTransaction").mockImplementation(async (...args) => {
    const id = await enqueue(...args)
    ids.push(id)
    if (fail) throw new Error("Queue failed")
    return id
  })
  const options = { since: now, errorContains: token, execute: true }
  try {
    const bundle = await build({ entryPoints: [`server/scripts/retry-failed-${kind}.ts`], bundle: true, write: false, platform: "node", format: "esm", packages: "external" })
    const readOnlyUrl = new URL(process.env.DATABASE_URL!)
    readOnlyUrl.searchParams.set("options", "-c default_transaction_read_only=on")
    const readOnlyProbe = new PrismaClient({ datasources: { db: { url: readOnlyUrl.toString() } } })
    try {
      expect(await readOnlyProbe.$queryRaw`SELECT current_setting('transaction_read_only') AS mode`).toEqual([{ mode: "on" }])
    } finally { await readOnlyProbe.$disconnect() }
    const dryRun = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", bundle.outputFiles[0].text, `retry-failed-${kind}`, "--since", now.toISOString(), "--error-contains", token], {
      env: { ...process.env, NODE_ENV: "production", DATABASE_URL: readOnlyUrl.toString() }, timeout: 10000,
    })
    expect(dryRun.stdout).toContain('"dry_run":true')
    expect(dryRun.stdout).toContain('"matched_count":1')
    expect(dryRun.stdout).toContain('"next_after_id":null')
    await boss.start()
    const preview = await retry({ ...options, execute: false })
    expect(preview.enqueuedCount).toBe(0)
    expect(ids).toHaveLength(0)
    existingJob = await boss.enqueue(queue, copyPayload)
    for (const state of ["created", "retry", "active"]) {
      await prisma.$executeRaw`UPDATE pgboss.job SET state = ${state}::pgboss.job_state WHERE id = ${existingJob}::uuid`
      expect((await retry(options)).enqueuedCount).toBe(0)
      expect(await readAsset()).toEqual(asset)
      expect(ids).toHaveLength(0)
    }
    await prisma.$executeRaw`UPDATE pgboss.job SET state = 'failed' WHERE id = ${existingJob}::uuid`
    await expect(retry(options)).rejects.toThrow("Queue failed")
    expect(await readAsset()).toEqual(asset)
    expect(await prisma.$queryRaw`SELECT id FROM pgboss.job WHERE id = ${ids[0]}::uuid`).toEqual([])
    const matchingCopy = { where: { id: copy.id }, data: { error_message: token } }
    if (kind === "audio") await prisma.audioAsset.update(matchingCopy)
    else await prisma.videoAsset.update(matchingCopy)
    fail = false
    const results = await Promise.all(Array.from({ length: 6 }, () => retry(options)))
    expect(results.reduce((sum, result) => sum + result.enqueuedCount, 0)).toBe(1)
    expect(ids).toHaveLength(2)
    expect(await readAsset()).toMatchObject({ processing_status: "pending", error_message: null })
    const [job] = await prisma.$queryRaw<Array<{ data: Record<string, number> }>>`SELECT data FROM pgboss.job WHERE id = ${ids[1]}::uuid`
    expect(job.data).toEqual(payload)
  } finally {
    spy.mockRestore()
    await boss.onModuleDestroy()
    if (existingJob) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE id = ${existingJob}::uuid`
    for (const id of ids) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE id = ${id}::uuid`
    await prisma.activeStorageBlob.delete({ where: { id: blob.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
}, 20000)

it.each(["audio", "video"] as const)("continues %s recovery past skipped outstanding work", async kind => {
  const prisma = new PrismaService(), boss = new BossService(), now = new Date(), token = crypto.randomUUID()
  const user = await prisma.user.create({ data: { email: `${token}@recovery-pages.test`, username: "Recovery pages", created_at: now, updated_at: now } })
  const blob = await prisma.activeStorageBlob.create({ data: { key: token, filename: "fixture", byte_size: 1, service_name: "test", created_at: now } })
  const blobs = [blob]
  const assets = []
  const queue = kind === "audio" ? "uploads.audio" : "uploads.video"
  const payload = (id: number) => kind === "audio" ? { audioAssetId: id } : { videoAssetId: id }
  try {
    for (let index = 0; index < 3; index++) {
      if (index) blobs.push(await prisma.activeStorageBlob.create({ data: { key: `${token}-${index}`, filename: "fixture", byte_size: 1, service_name: "test", created_at: now } }))
      const data = { blob_id: blobs[index].id, owner_id: user.id, source_type: "User", source_id: user.id, title: "Recovery", original_filename: "fixture", processing_status: "failed", error_message: token, created_at: now, updated_at: now }
      assets.push(kind === "audio" ? await prisma.audioAsset.create({ data }) : await prisma.videoAsset.create({ data }))
    }
    await boss.start()
    await boss.enqueue(queue, payload(assets[0].id))
    const options = { since: now, errorContains: token, execute: true, limit: 1 }
    const first = await retryFailedMediaAssets(prisma, boss, kind, options)
    expect(first.assets.map(asset => asset.id)).toEqual([assets[0].id])
    expect(first.enqueuedCount).toBe(0)
    expect(first.nextAfterId).toBe(assets[0].id)
    const second = await retryFailedMediaAssets(prisma, boss, kind, { ...options, afterId: first.nextAfterId! })
    expect(second.assets.map(asset => asset.id)).toEqual([assets[1].id])
    expect(second.enqueuedCount).toBe(1)
    expect(second.nextAfterId).toBe(assets[1].id)
    const last = await retryFailedMediaAssets(prisma, boss, kind, { ...options, afterId: second.nextAfterId!, execute: false })
    expect(last.assets.map(asset => asset.id)).toEqual([assets[2].id])
    expect(last.enqueuedCount).toBe(0)
    expect(last.nextAfterId).toBeNull()
  } finally {
    await boss.onModuleDestroy()
    for (const asset of assets) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name = ${queue} AND data @> ${JSON.stringify(payload(asset.id))}::jsonb`
    await prisma.activeStorageBlob.deleteMany({ where: { id: { in: blobs.map(item => item.id) } } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
