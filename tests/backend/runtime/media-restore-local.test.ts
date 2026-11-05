import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { afterEach, expect, it } from "vitest"
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
async function fixture(key = "nested/object") {
  const root = await mkdtemp(join(tmpdir(), "afire-restore-")); roots.push(root)
  const source = join(root, "backup"), target = join(root, "restored")
  await mkdir(source)
  const object = { key, file: hash(key), bytes: 5, sha256: hash("bytes") }
  await writeFile(join(source, object.file), "bytes")
  const save = (objects = [object]) => writeFile(join(source, "manifest.json"), JSON.stringify({ version: 1, objects }))
  await save()
  const run = () => promisify(execFile)(process.execPath, ["bin/media-restore-local.mjs"], { env: { ...process.env, MEDIA_BACKUP_DIRECTORY: source, MEDIA_RESTORE_DIRECTORY: target } })
  return { source, target, object, save, run }
}
it("restores original keys, verifies persisted bytes and refuses existing stores", async () => {
  const f = await fixture()
  expect(JSON.parse((await f.run()).stdout)).toEqual({ objects: 1, bytes: 5, allRestoredHashesMatch: true, originalKeysRestored: true, s3MetadataRestored: false })
  expect(await readFile(join(f.target, f.object.key), "utf8")).toBe("bytes")
  expect((await stat(f.target)).mode & 0o777).toBe(0o700)
  expect((await stat(join(f.target, f.object.key))).mode & 0o777).toBe(0o600)
  await expect(f.run()).rejects.toMatchObject({ code: 1, stdout: "" })
})
it.each(["../escape", "/absolute", "a/../b", "a\\b", "a//b"])("rejects unsafe local key %s before creating the store", async key => {
  const f = await fixture(key)
  await expect(f.run()).rejects.toMatchObject({ code: 1, stdout: "" })
  await expect(stat(f.target)).rejects.toMatchObject({ code: "ENOENT" })
})
it.each(["corrupt", "missing", "symlink", "duplicate"])("rejects %s backup without success output", async mode => {
  const f = await fixture()
  const path = join(f.source, f.object.file)
  if (mode === "corrupt") await writeFile(path, "wrong")
  if (mode === "missing" || mode === "symlink") await rm(path)
  if (mode === "symlink") { await writeFile(join(f.source, "other"), "bytes"); await symlink(join(f.source, "other"), path) }
  if (mode === "duplicate") await f.save([f.object, f.object])
  const error = await f.run().catch(error => error)
  expect(error.code).toBe(1); expect(error.stdout).toBe("")
  expect(error.stderr).not.toContain(f.source)
})
