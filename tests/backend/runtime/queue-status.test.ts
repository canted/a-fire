import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createServer, type Socket } from "node:net"
import { expect, it } from "vitest"

const run = (target: string) => promisify(execFile)(process.execPath, ["bin/queue-status.mjs"], {
  env: { ...process.env, QUEUE_STATUS_DATABASE_URL: target }, timeout: 16000,
})

it.each(["", "not-a-url-private-sentinel", "https://private-user:private-password@127.0.0.1/private-db"])("fails closed without printing target details (%#)", async target => {
  const error = await run(target).catch(error => error)
  expect(error.code).toBe(1)
  expect(error.stdout).toBe("")
  expect(error.stderr).toContain("No queue status was established")
  expect(error.stderr).not.toContain("private-")
  expect(error.stderr).not.toContain("Error:")
})

it("bounds a stalled PostgreSQL handshake without emitting connection credentials", async () => {
  const sockets = new Set<Socket>()
  const server = createServer(socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)) })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Expected local test listener")
  try {
    const error = await run(`postgresql://private-user:private-password@127.0.0.1:${address.port}/private-db`).catch(error => error)
    expect(error.code).toBe(1)
    expect(error.killed).not.toBe(true)
    expect(error.stdout).toBe("")
    expect(error.stderr).toContain("Queue inspection failed")
    expect(error.stderr).not.toContain("private-")
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}, 20000)
