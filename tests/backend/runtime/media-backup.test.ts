import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { createHash } from "node:crypto"
import { afterEach, expect, it } from "vitest"
import { backupMedia } from "../../../bin/media-backup.mjs"
import type { S3Client } from "@aws-sdk/client-s3"

// The fixture implements only the List/Get commands this read-only tool uses.
const reader = (client: ReturnType<typeof source>) => client as unknown as Pick<S3Client, "send">

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function destination() {
  const root = await mkdtemp(join(tmpdir(), "afire-media-backup-"))
  roots.push(root)
  return join(root, "backup")
}
const content = Buffer.from("retained image bytes")
const item = { Key: "../../private/path", Size: content.length, ETag: '"opaque-etag"', LastModified: new Date("2026-10-01T00:00:00Z") }
function source(options: { changed?: boolean, truncated?: boolean, short?: boolean, error?: boolean } = {}) {
  let listings = 0
  const commands: string[] = []
  return {
    commands,
    async send(command: { constructor: { name: string }, input: Record<string, unknown> }) {
      commands.push(command.constructor.name)
      if (command.constructor.name === "ListObjectsV2Command") {
        listings++
        return { Contents: [options.changed && listings > 1 ? { ...item, ETag: '"changed"' } : item], IsTruncated: options.truncated }
      }
      expect(command.constructor.name).toBe("GetObjectCommand")
      expect(command.input.IfMatch).toBe(item.ETag)
      if (options.error) throw Error("private credential sentinel")
      return { Body: Readable.from([options.short ? content.subarray(1) : content]), ContentLength: content.length, ETag: item.ETag, ContentType: "image/png", Metadata: { original: "preserved" } }
    },
  }
}

it("persists private objects without using keys as paths and rereads their hashes", async () => {
  const target = await destination()
  const client = source()
  expect(await backupMedia(reader(client), "explicit-bucket", target)).toEqual({ objects: 1, bytes: content.length, persistedChecksumsVerified: true, inventoryUnchanged: true })
  const manifest = JSON.parse(await readFile(join(target, "manifest.json"), "utf8"))
  const [record] = manifest.objects
  expect(record.key).toBe(item.Key)
  expect(record.file).toMatch(/^[a-f0-9]{64}$/)
  expect(await readFile(join(target, record.file))).toEqual(content)
  expect(record.sha256).toBe(createHash("sha256").update(content).digest("hex"))
  expect(record.metadata).toEqual({ original: "preserved" })
  expect((await stat(target)).mode & 0o777).toBe(0o700)
  expect((await stat(join(target, "manifest.json"))).mode & 0o777).toBe(0o600)
  expect((await stat(join(target, record.file))).mode & 0o777).toBe(0o600)
  expect(client.commands).toEqual(["ListObjectsV2Command", "GetObjectCommand", "ListObjectsV2Command"])
  await expect(backupMedia(reader(client), "explicit-bucket", target)).rejects.toThrow()
})

it.each([{ changed: true }, { truncated: true }, { short: true }, { error: true }])("never marks an incomplete or changing backup complete: %j", async options => {
  const target = await destination()
  await expect(backupMedia(reader(source(options)), "explicit-bucket", target)).rejects.toThrow()
  expect(await readdir(target)).not.toContain("manifest.json")
})

it("follows pagination and captures every page in both inventories", async () => {
  const target = await destination()
  const client = source()
  const original = client.send.bind(client)
  let listings = 0
  client.send = async command => {
    if (command.constructor.name !== "ListObjectsV2Command") return original(command)
    listings++
    if (listings % 2) return { Contents: [], IsTruncated: true, NextContinuationToken: "next" }
    expect(command.input.ContinuationToken).toBe("next")
    return { Contents: [item], IsTruncated: false }
  }
  expect((await backupMedia(reader(client), "explicit-bucket", target)).objects).toBe(1)
  expect(listings).toBe(4)
})
