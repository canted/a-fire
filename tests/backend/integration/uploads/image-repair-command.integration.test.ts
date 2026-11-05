import "reflect-metadata"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { build } from "esbuild"
import sharp from "sharp"
import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { StorageService } from "@server/storage/storage.service"
import { imageVariantKey } from "@server/uploads/images/image-variants"
import { IMAGE_TRANSFORM_VERSION } from "../../../../types/image-policy"
import { parseImageVariantInventoryArgs, parseRepairImageVariantArgs } from "@server/runtime/repairImageVariants"

it("previews image repairs read-only and repairs missing or unrecorded objects through the CLI", async () => {
  const prisma = new PrismaService()
  const root = await mkdtemp(path.join(os.tmpdir(), "afire-image-command-"))
  const storage = new StorageService()
  Object.assign(storage, { localRoot: root, useS3: false })
  const original = await sharp({ create: { width: 800, height: 400, channels: 3, background: "red" } }).png().toBuffer()
  const blob = await prisma.activeStorageBlob.create({ data: { key: crypto.randomUUID(), filename: "fixture.png", content_type: "image/png", byte_size: original.length, service_name: "test", created_at: new Date() } })
  const extra = await prisma.activeStorageBlob.createManyAndReturn({ data: ["image/png", "application/pdf"].map(content_type => ({ key: crypto.randomUUID(), filename: "fixture", content_type, byte_size: 1, service_name: "test", created_at: new Date() })) })
  try {
    await storage.put(blob.key, original)
    await storage.put(imageVariantKey(blob.key, "w320"), Buffer.from("incomplete"))
    await prisma.activeStorageVariantRecord.create({ data: { blob_id: blob.id, variation_digest: `v${IMAGE_TRANSFORM_VERSION}/w600` } })
    const before = await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })
    const bundle = await build({ entryPoints: ["server/scripts/repair-image-variants.ts"], bundle: true, write: false, platform: "node", format: "esm", packages: "external" })
    const readOnly = new URL(process.env.DATABASE_URL!)
    readOnly.searchParams.set("options", "-c default_transaction_read_only=on")
    const probe = new PrismaClient({ datasources: { db: { url: readOnly.toString() } } })
    try { expect(await probe.$queryRaw`SELECT current_setting('transaction_read_only') AS mode`).toEqual([{ mode: "on" }]) }
    finally { await probe.$disconnect() }
    const run = async (execute: boolean) => {
      const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", bundle.outputFiles[0].text, "repair", "--blob-id", String(blob.id), "--digest", "w320", "--digest", "w600", ...(execute ? ["--execute"] : [])], {
        timeout: 10000, env: { ...process.env, NODE_ENV: "production", UPLOADS_STORAGE_BACKEND: "local", UPLOADS_STORAGE_ROOT: root, DATABASE_URL: execute ? process.env.DATABASE_URL : readOnly.toString() },
      })
      return JSON.parse(stdout.trim().split("\n").at(-1)!)
    }
    expect(await run(false)).toMatchObject({ dry_run: true, after: null, before: { source_exists: true, variants: [
      { digest: "w320", recorded: false, stored: true, requires_work: true },
      { digest: "w600", recorded: true, stored: false, requires_work: true },
    ] } })
    const inventoryBundle = await build({ entryPoints: ["server/scripts/inspect-image-variants.ts"], bundle: true, write: false, platform: "node", format: "esm", packages: "external" })
    const inventory = async (afterId: number) => {
      const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", inventoryBundle.outputFiles[0].text, "inventory", "--after-id", String(afterId), "--limit", "1", "--digest", "w320"], {
        timeout: 10000, env: { ...process.env, NODE_ENV: "production", UPLOADS_STORAGE_BACKEND: "local", UPLOADS_STORAGE_ROOT: root, DATABASE_URL: readOnly.toString() },
      })
      return JSON.parse(stdout.trim())
    }
    const firstPage = await inventory(blob.id - 1)
    expect(firstPage).toMatchObject({ requested_variants: ["w320"], images: [{ blob_id: blob.id, source_exists: true }], next_after_id: blob.id })
    expect(firstPage.images).toHaveLength(1)
    const lastPage = await inventory(firstPage.next_after_id)
    expect(lastPage).toMatchObject({ images: [{ blob_id: extra.find(item => item.content_type === "image/png")!.id, source_exists: false }], next_after_id: null })
    expect(lastPage.images).toHaveLength(1)
    expect(await prisma.activeStorageBlob.findMany({ where: { id: { in: extra.map(item => item.id) } }, orderBy: { id: "asc" } })).toEqual(extra.sort((a, b) => a.id - b.id))
    expect(await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })).toEqual(before)
    expect(await storage.getBuffer(imageVariantKey(blob.key, "w320"))).toEqual(Buffer.from("incomplete"))
    const repaired = await run(true)
    expect(repaired.after.variants.every((variant: { requires_work: boolean }) => !variant.requires_work)).toBe(true)
    expect(await prisma.activeStorageVariantRecord.count({ where: { blob_id: blob.id } })).toBe(2)
    const bytes = await storage.getBuffer(imageVariantKey(blob.key, "w320"))
    expect((await sharp(bytes).metadata()).width).toBe(320)
    expect((await run(true)).before).toEqual(repaired.after)
    expect(await storage.getBuffer(imageVariantKey(blob.key, "w320"))).toEqual(bytes)
    expect(await storage.getBuffer(blob.key)).toEqual(original)
  } finally {
    await prisma.activeStorageVariantRecord.deleteMany({ where: { blob_id: blob.id } })
    await prisma.activeStorageBlob.deleteMany({ where: { id: { in: [blob.id, ...extra.map(item => item.id)] } } })
    await prisma.$disconnect()
    await rm(root, { recursive: true, force: true })
  }
})

it.each([[], ["--blob-id", "0", "--digest", "w320"], ["--blob-id", "1"], ["--blob-id", "1", "--digest", "../other"]].map(args => ({ args })))("rejects unsupported image repair arguments $args", ({ args }) => {
  expect(() => parseRepairImageVariantArgs(args)).toThrow()
})


it.each([[], ["--digest", "w320", "--limit", "101"], ["--digest", "w320", "--after-id", "-1"], ["--digest", "w320", "--execute"]].map(args => ({ args })))("rejects invalid inventory arguments $args", ({ args }) => {
  expect(() => parseImageVariantInventoryArgs(args)).toThrow()
})
