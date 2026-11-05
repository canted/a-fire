import { CommittedIdChangeListener } from "./committed-id-change-listener"

export const NOTE_CHANGE_CHANNEL = "afire_note_changes"

/** Note-specific adapter; connection lifecycle belongs to the shared transport. */
export class NoteChangeListener extends CommittedIdChangeListener {
  constructor(connectionString: string, changed: (id: number) => void, resync: () => void, warn: () => void) {
    super(NOTE_CHANGE_CHANNEL, "afire-note-changes", connectionString, changed, resync, warn)
  }
}
