import { describe, expect, it } from "vitest"
import { OutgoingMessage, type Document } from "@hocuspocus/server"
import * as Y from "yjs"
import { noteSyncUpdate } from "@server/realtime/note-sync-update"

describe("durable Note protocol updates", () => {
  it.each(["sync", "reply"])("extracts the exact update from a %s envelope", kind => {
    const document = new Y.Doc()
    try {
      document.getMap("probe").set("text", "stored")
      const update = Y.encodeStateAsUpdate(document)
      const message = new OutgoingMessage("note:1")
      const frame = (kind === "sync" ? message.createSyncMessage() : message.createSyncReplyMessage()).writeUpdate(update).toUint8Array()
      expect(noteSyncUpdate(frame, "note:1")).toEqual(update)
      expect(() => noteSyncUpdate(frame, "note:2")).toThrow("Invalid Note document")
      expect(() => noteSyncUpdate(frame.slice(0, -1), "note:1")).toThrow()
    } finally { document.destroy() }
  })
  it("does not store awareness queries or state-vector requests as edits", () => {
    const document = new Y.Doc()
    try {
      expect(noteSyncUpdate(new OutgoingMessage("note:1").writeQueryAwareness().toUint8Array(), "note:1")).toBeNull()
      expect(noteSyncUpdate(new OutgoingMessage("note:1").createSyncMessage().writeFirstSyncStepFor(document as Document).toUint8Array(), "note:1")).toBeNull()
    } finally { document.destroy() }
  })
})
