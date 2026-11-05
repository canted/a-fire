import { IncomingMessage, MessageType } from "@hocuspocus/server"
import { messageYjsSyncStep1, messageYjsSyncStep2, messageYjsUpdate } from "y-protocols/sync"

/** Decode only the durable part of a Hocuspocus frame; awareness is ephemeral. */
export function noteSyncUpdate(bytes: Uint8Array, documentName: string): Uint8Array | null {
  const message = new IncomingMessage(bytes)
  if (message.readVarString() !== documentName) throw new Error("Invalid Note document")
  const type = message.readVarUint()
  if (type !== MessageType.Sync && type !== MessageType.SyncReply) return null
  const step = message.readVarUint()
  if (step === messageYjsSyncStep1) return null
  if (step !== messageYjsSyncStep2 && step !== messageYjsUpdate) throw new Error("Invalid Note sync message")
  return message.readVarUint8Array()
}
