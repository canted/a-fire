import { mkdtemp, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createServer } from "node:http"
import { once } from "node:events"
import { afterEach, expect, it, vi } from "vitest"
import { StorageService } from "@server/storage/storage.service"

afterEach(() => vi.unstubAllEnvs())

it.each(["headers", "body", "buffer upload", "file upload"])("cancels an actual S3 transfer stalled at %s and closes its connection", async stage => {
  const root = await mkdtemp(path.join(os.tmpdir(), "afire-storage-cancel-"))
  const source = path.join(root, "source")
  await writeFile(source, Buffer.alloc(1024 * 1024))
  let closeConnection!: Promise<unknown>
  let requestReceived!: () => void
  const received = new Promise<void>(resolve => { requestReceived = resolve })
  const server = createServer((request, response) => {
    request.resume()
    closeConnection = once(response, "close")
    if (stage === "body") {
      response.writeHead(200, { "Content-Length": "100000", "Content-Type": "application/octet-stream" })
      response.write("partial")
    }
    requestReceived()
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address() as { port: number }
  vi.stubEnv("UPLOADS_STORAGE_BACKEND", "s3")
  vi.stubEnv("AWS_ENDPOINT_URL_S3", `http://127.0.0.1:${address.port}`)
  vi.stubEnv("AWS_ACCESS_KEY_ID", "fixture")
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "fixture")
  vi.stubEnv("AWS_REGION", "us-east-1")
  const storage = new StorageService()
  const controller = new AbortController()
  try {
    const work = stage === "buffer upload"
      ? storage.put("fixture", Buffer.alloc(1024 * 1024), "application/octet-stream", controller.signal)
      : stage === "file upload"
        ? storage.putFile("fixture", source, "application/octet-stream", controller.signal)
        : storage.getBuffer("fixture", controller.signal)
    const rejected = expect(work).rejects.toMatchObject({ name: "AbortError" })
    await received
    controller.abort()
    await rejected
    await closeConnection
  } finally {
    controller.abort()
    storage.onModuleDestroy()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(root, { recursive: true, force: true })
  }
})
