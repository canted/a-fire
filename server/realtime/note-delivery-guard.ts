import { IncomingMessage, MessageType } from "@hocuspocus/server"
import type { WebSocket } from "ws"

const MAX_PENDING_BYTES = 16 * 1024 * 1024
const MAX_PENDING_MESSAGES = 256

/** Hocuspocus has no awaited outbound hook. Guard its socket boundary instead. */
export function guardNoteDelivery(socket: WebSocket, authorize: (documentName: string) => Promise<void>) {
  const send = socket.send.bind(socket)
  let queue = Promise.resolve()
  let pendingBytes = 0
  let pendingMessages = 0
  let stopped = false
  socket.once("close", () => { stopped = true })
  socket.send = (data, options?: Parameters<WebSocket["send"]>[1] | ((error?: Error) => void), callback?: (error?: Error) => void) => {
    const done = typeof options === "function" ? options : callback
    if (stopped) { done?.(new Error("Note connection closed")); return }
    // All Hocuspocus protocol frames are binary Uint8Arrays. Fail closed on drift.
    if (!(data instanceof Uint8Array)) {
      stopped = true
      socket.close(1008, "Invalid Note frame")
      done?.(new Error("Invalid Note frame"))
      return
    }
    const bytes = Uint8Array.from(data)
    pendingBytes += bytes.byteLength
    pendingMessages++
    if (pendingBytes > MAX_PENDING_BYTES || pendingMessages > MAX_PENDING_MESSAGES) {
      stopped = true
      socket.close(1013, "Note delivery overloaded")
      done?.(new Error("Note delivery overloaded"))
      return
    }
    queue = queue.then(async () => {
      try {
        if (stopped) throw new Error("Note connection closed")
        const frame = new IncomingMessage(bytes)
        const documentName = frame.readVarString()
        const type = frame.readVarUint()
        // Authentication and close frames contain no Note content. Sync, awareness,
        // stateless and future frame types all require current authorization.
        if (type !== MessageType.Auth && type !== MessageType.CLOSE) await authorize(documentName)
        if (stopped || socket.readyState !== socket.OPEN) throw new Error("Note connection closed")
        if (typeof options === "function" || options === undefined) send(bytes, done)
        else send(bytes, options, done)
      } catch {
        stopped = true
        socket.close(1008, "Note access unavailable")
        done?.(new Error("Note access unavailable"))
      } finally {
        pendingBytes -= bytes.byteLength
        pendingMessages--
      }
    })
  }
}
