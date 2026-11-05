import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, it, vi } from "vitest"
import { StorageService } from "@server/storage/storage.service"

it.each(["buffer", "file"] as const)("publishes local %s writes atomically and preserves the previous object on failure", async mode => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "afire-storage-publication-"))
  const service = new StorageService()
  Object.assign(service, { localRoot: root, useS3: false })
  const key = "uploads/object", destination = path.join(root, key), source = path.join(root, "source")
  await service.put(key, Buffer.from("previous object"))
  await fs.writeFile(source, "complete replacement")
  const write = () => mode === "buffer" ? service.put(key, Buffer.from("complete replacement")) : service.putFile(key, source)
  const rename = vi.spyOn(fs, "rename").mockImplementationOnce(async (from, to) => {
    expect(String(to)).toBe(destination)
    expect(await fs.readFile(destination, "utf8")).toBe("previous object")
    expect(await fs.readFile(from, "utf8")).toBe("complete replacement")
    throw new Error("Publication interrupted")
  })
  try {
    await expect(write()).rejects.toThrow("Publication interrupted")
    expect(await service.getBuffer(key)).toEqual(Buffer.from("previous object"))
    expect(await fs.readdir(path.dirname(destination))).toEqual(["object"])
    rename.mockRestore()
    await write()
    expect(await service.getBuffer(key)).toEqual(Buffer.from("complete replacement"))
    expect(await fs.readdir(path.dirname(destination))).toEqual(["object"])
    expect(await fs.readFile(source, "utf8")).toBe("complete replacement")
  } finally {
    rename.mockRestore()
    await fs.rm(root, { recursive: true, force: true })
  }
})

it.each(["buffer", "file"] as const)("keeps the old object after a %s writer is killed before publication", async mode => {
  const { build } = await import("esbuild")
  const { spawn } = await import("node:child_process")
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "afire-storage-kill-"))
  const service = new StorageService()
  Object.assign(service, { localRoot: root, useS3: false })
  await service.put("uploads/object", Buffer.from("previous"))
  await fs.writeFile(path.join(root, "source"), "replacement")
  const bundle = await build({ entryPoints: ["tests/backend/fixtures/storage-process-interruption.ts"], bundle: true, write: false, platform: "node", format: "esm", packages: "external" })
  const child = spawn(process.execPath, ["--input-type=module", "-e", bundle.outputFiles[0].text, "storage-fixture", root, mode], { stdio: ["ignore", "ignore", "pipe", "ipc"] })
  const closed = new Promise<{ code: number | null; signal: string | null }>(resolve => child.once("close", (code, signal) => resolve({ code, signal })))
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Writer did not reach publication")), 10000)
      child.once("message", message => {
        clearTimeout(timer)
        if ((message as { stage?: string }).stage !== "ready-to-publish") reject(new Error("Unexpected stage"))
        else resolve()
      })
      child.once("error", error => { clearTimeout(timer); reject(error) })
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Writer exited before publication")) })
    })
    expect(await service.getBuffer("uploads/object")).toEqual(Buffer.from("previous"))
    child.kill("SIGKILL")
    expect(await closed).toEqual({ code: null, signal: "SIGKILL" })
    expect(await service.getBuffer("uploads/object")).toEqual(Buffer.from("previous"))
    await service.put("uploads/object", Buffer.from("retried"))
    expect(await service.getBuffer("uploads/object")).toEqual(Buffer.from("retried"))
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    await closed
    await fs.rm(root, { recursive: true, force: true })
  }
}, 20000)
