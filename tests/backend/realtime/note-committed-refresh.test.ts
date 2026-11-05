import { expect, it, vi } from "vitest"
import * as Y from "yjs"
import { HocuspocusService } from "@server/realtime/hocuspocus.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("isolates corrupt stored Note state without blocking healthy Notes in the same refresh batch", async () => {
  const corrupt = new Y.Doc()
  const healthy = new Y.Doc()
  const saved = new Y.Doc()
  saved.getMap("probe").set("text", "Committed")
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  try {
    const service = withTestDependencies(new HocuspocusService(), {
      prisma: { document: { findMany: vi.fn().mockResolvedValue([
        { docable_id: 1, ydoc_state: Uint8Array.of(255) },
        { docable_id: 2, ydoc_state: Y.encodeStateAsUpdate(saved) },
      ]) } },
      server: { documents: new Map([["note:1", corrupt], ["note:2", healthy]]), loadingDocuments: new Map() },
      changeListener: {},
    })
    const internal = service as unknown as { pendingNoteChanges: Set<number>; refreshCommittedNotes(): Promise<void> }
    internal.pendingNoteChanges.add(1)
    internal.pendingNoteChanges.add(2)
    await internal.refreshCommittedNotes()
    expect(healthy.getMap("probe").get("text")).toBe("Committed")
    expect(corrupt.getMap("probe").size).toBe(0)
    expect(warn).toHaveBeenCalledWith("[Notes] Invalid committed state for Note 1")
    expect(internal.pendingNoteChanges.size).toBe(0)
  } finally { warn.mockRestore(); corrupt.destroy(); healthy.destroy(); saved.destroy() }
})
