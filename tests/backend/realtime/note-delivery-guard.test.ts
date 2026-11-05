import { it, expect, vi } from "vitest"
import { OutgoingMessage } from "@hocuspocus/server"
import type { WebSocket } from "ws"
import { guardNoteDelivery } from "@server/realtime/note-delivery-guard"

function setup(authorize: (name: string) => Promise<void>) {
  const rawSend = vi.fn()
  const socket = { send: rawSend, close: vi.fn(), once: vi.fn(), readyState: 1, OPEN: 1 }
  guardNoteDelivery(socket as unknown as WebSocket, authorize)
  return { socket, rawSend }
}
const frame = () => new OutgoingMessage("note:1").writeStateless("private content").toUint8Array()

it("authorizes queued frames at delivery time and drops frames when authorization fails", async () => {
  let release!: () => void
  let active = true
  const authorize = vi.fn(async () => {
    if (authorize.mock.calls.length === 1) await new Promise<void>(resolve => { release = resolve })
    if (!active) throw new Error("revoked")
  })
  const { socket, rawSend } = setup(authorize)
  const callback = vi.fn()
  ;(socket as unknown as WebSocket).send(frame(), callback)
  ;(socket as unknown as WebSocket).send(frame(), callback)
  await vi.waitFor(() => expect(release).toBeTypeOf("function"))
  active = false
  release()
  await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(2))
  expect(rawSend).not.toHaveBeenCalled()
  expect(socket.close).toHaveBeenCalledWith(1008, "Note access unavailable")
})

it("bounds pending frames while authorization is slow", async () => {
  let release!: () => void
  const { socket, rawSend } = setup(() => new Promise<void>(resolve => { release = resolve }))
  ;(socket as unknown as WebSocket).send(frame())
  await vi.waitFor(() => expect(release).toBeTypeOf("function"))
  for (let i = 0; i < 256; i++) (socket as unknown as WebSocket).send(frame())
  expect(socket.close).toHaveBeenCalledWith(1013, "Note delivery overloaded")
  release()
  await vi.waitFor(() => expect(rawSend).not.toHaveBeenCalled())
})
