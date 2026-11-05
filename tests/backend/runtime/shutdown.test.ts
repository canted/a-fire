import { EventEmitter } from "node:events"
import { createServer, get } from "node:http"
import { afterEach, expect, it, vi } from "vitest"
import { drainHttpServer, installShutdownHandlers } from "@server/runtime/shutdown"

afterEach(() => vi.useRealTimers())

it("waits for cleanup and ignores repeated signals", async () => {
  const target = Object.assign(new EventEmitter(), { exit: vi.fn() })
  let finish!: () => void
  const shutdown = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const dispose = installShutdownHandlers(shutdown, { target: target as never })
  try {
    target.emit("SIGTERM")
    target.emit("SIGINT")
    await Promise.resolve()
    expect(shutdown).toHaveBeenCalledOnce()
    expect(target.exit).not.toHaveBeenCalled()
    finish()
    await vi.waitFor(() => expect(target.exit).toHaveBeenCalledWith(0))
  } finally { dispose() }
})

it.each(["failure", "deadline"])("exits unsuccessfully on cleanup %s", async mode => {
  vi.useFakeTimers()
  const target = Object.assign(new EventEmitter(), { exit: vi.fn() })
  const error = vi.fn()
  const dispose = installShutdownHandlers(() => mode === "failure" ? Promise.reject(new Error("Broken")) : new Promise(() => {}), { target: target as never, error, timeoutMs: 100 })
  try {
    target.emit("SIGTERM")
    await vi.advanceTimersByTimeAsync(100)
    expect(target.exit).toHaveBeenCalledExactlyOnceWith(1)
    expect(error).toHaveBeenCalledOnce()
  } finally { dispose() }
})

it("stops HTTP admission while allowing an accepted request to finish", async () => {
  let accepted!: () => void
  const started = new Promise<void>(resolve => { accepted = resolve })
  let respond!: () => void
  const server = createServer((_request, response) => {
    respond = () => response.end("Committed")
    accepted()
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as { port: number }).port
  const response = new Promise<string>((resolve, reject) => {
    get(`http://127.0.0.1:${port}`, result => {
      let body = ""
      result.on("data", chunk => { body += chunk })
      result.on("end", () => resolve(body))
    }).on("error", reject)
  })
  try {
    await started
    let drained = false
    const closing = drainHttpServer(server).then(() => { drained = true })
    expect(server.listening).toBe(false)
    expect(drained).toBe(false)
    respond()
    expect(await response).toBe("Committed")
    await closing
    expect(drained).toBe(true)
  } finally { server.closeAllConnections(); server.close() }
})
