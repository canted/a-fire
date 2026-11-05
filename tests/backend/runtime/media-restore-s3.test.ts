import { createHash } from "node:crypto"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { afterEach, expect, it, vi } from "vitest"
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3"
import { restoreMediaToS3 } from "../../../bin/media-restore-s3.mjs"

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "afire-s3-restore-")); roots.push(root)
  const source = join(root, "backup"); await mkdir(source)
  const objects = ["nested/first", "second"].map(key => ({ key, file: hash(key), bytes: Buffer.byteLength(key), sha256: hash(key),
    contentType: "image/png", contentEncoding: null, cacheControl: "private, no-cache", contentDisposition: "inline", metadata: { original: "preserved" } }))
  for (const item of objects) await writeFile(join(source, item.file), item.key)
  const save = () => writeFile(join(source, "manifest.json"), JSON.stringify({ version: 1, bucket: "source-bucket", objects }))
  await save()
  const stored = new Map<string, { bytes: Buffer; input: PutObjectCommand["input"] }>()
  let lists = 0
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof ListObjectsV2Command) {
      lists++
      return { Contents: [...stored].map(([Key, value]) => ({ Key, Size: value.bytes.length })) }
    }
    if (command instanceof PutObjectCommand) {
      expect(command.input.IfNoneMatch).toBe("*")
      if (stored.has(command.input.Key!)) throw Error("Precondition failed")
      const chunks: Buffer[] = []
      for await (const chunk of command.input.Body as Readable) chunks.push(Buffer.from(chunk))
      stored.set(command.input.Key!, { bytes: Buffer.concat(chunks), input: command.input })
      return {}
    }
    if (command instanceof GetObjectCommand) {
      const item = stored.get(command.input.Key!)!
      return { ...item.input, ContentLength: item.bytes.length, Body: Readable.from(item.bytes) }
    }
    throw Error("Unexpected command")
  })
  const client = { send } as unknown as Pick<S3Client, "send">
  return { source, objects, save, stored, send, client, lists: () => lists }
}

it("restores bytes, original keys and metadata, then verifies the complete target inventory", async () => {
  const f = await fixture()
  await expect(restoreMediaToS3(f.client, f.source, "restore-bucket")).resolves.toEqual({ objects: 2, bytes: 18, allRestoredHashesMatch: true, objectMetadataVerified: true, inventoryVerified: true })
  expect(f.lists()).toBe(2)
  expect([...f.stored.keys()]).toEqual(f.objects.map(item => item.key))
  for (const item of f.objects) expect(f.stored.get(item.key)?.input).toMatchObject({ ContentType: item.contentType, CacheControl: item.cacheControl, ContentDisposition: item.contentDisposition, Metadata: item.metadata })
})
it.each(["same-bucket", "corrupt-source", "invalid-metadata", "duplicate-key"])("rejects %s before any remote operation", async failure => {
  const f = await fixture()
  if (failure === "corrupt-source") await writeFile(join(f.source, f.objects[1].file), "corrupt")
  if (failure === "invalid-metadata") { f.objects[1].contentType = "bad\r\nheader"; await f.save() }
  if (failure === "duplicate-key") { f.objects.push(f.objects[0]); await f.save() }
  await expect(restoreMediaToS3(f.client, f.source, failure === "same-bucket" ? "source-bucket" : "restore-bucket")).rejects.toThrow()
  expect(f.send).not.toHaveBeenCalled()
})
it("refuses an occupied target without writing", async () => {
  const f = await fixture()
  f.stored.set("existing", { bytes: Buffer.from("keep"), input: { Bucket: "restore-bucket", Key: "existing" } })
  await expect(restoreMediaToS3(f.client, f.source, "restore-bucket")).rejects.toThrow("not empty")
  expect(f.send).toHaveBeenCalledOnce()
  expect(f.stored.get("existing")?.bytes.toString()).toBe("keep")
})
it.each(["bytes", "metadata", "inventory", "collision"])("does not report completion after a target %s failure", async failure => {
  const f = await fixture(), original = f.send.getMockImplementation()!
  f.send.mockImplementation(async command => {
    if (failure === "collision" && command instanceof PutObjectCommand) f.stored.set(command.input.Key!, { bytes: Buffer.from("other writer"), input: { Bucket: "restore-bucket", Key: command.input.Key } })
    const result = await original(command)
    if (command instanceof GetObjectCommand && failure === "bytes") return { ...result, Body: Readable.from(Buffer.from("wrong")) }
    if (command instanceof GetObjectCommand && failure === "metadata") return { ...result, Metadata: { changed: "value" } }
    if (command instanceof ListObjectsV2Command && failure === "inventory" && f.lists() > 1) return { Contents: [{ Key: "unexpected", Size: 0 }] }
    return result
  })
  await expect(restoreMediaToS3(f.client, f.source, "restore-bucket")).rejects.toThrow()
  expect(f.stored.size).toBeGreaterThan(0)
})
