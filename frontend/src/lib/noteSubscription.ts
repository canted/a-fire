import type { Consumer } from './createCable';
import type { Note } from './api/notes';
export type NoteUpdate = { type: 'meta'; page_id: number | string; title: string | null; icon: string | null; actor_id?: number } | { type: 'content'; page_id: number | string; content: Note['content']; version?: number; actor_id?: number };
export function mergeNoteUpdate(previous: Note | undefined, payload: NoteUpdate): Note | undefined {
  if (!previous) return previous;
  if (payload.type === 'meta') return { ...previous, title: payload.title, icon: payload.icon };
  if (payload.version === undefined || payload.version < (previous.version ?? 0)) return previous;
  return { ...previous, content: payload.content, version: payload.version };
}
/** Mutation responses contain a whole Note, but only own the field they saved.
 * Metadata and body writes can complete in either order. */
export function mergeNoteMutation(previous: Note | undefined, saved: Note, kind: 'meta' | 'content'): Note {
  if (!previous || previous.id !== saved.id) return saved;
  if (kind === 'meta') return { ...previous, title: saved.title, icon: saved.icon };
  if ((saved.version ?? 0) < (previous.version ?? 0)) return previous;
  return { ...previous, content: saved.content, version: saved.version };
}
export function subscribeToNote(consumer: Consumer, id: string | number, viewer: number | undefined, changed: (event: NoteUpdate) => void, refresh?: () => void) {
  return consumer.subscriptions.create<NoteUpdate>({ channel: "NoteChannel", id }, {
    connected: refresh,
    received(payload) {
      if (payload.page_id && String(payload.page_id) !== String(id)) return;
      if (payload.actor_id && payload.actor_id === viewer) return;
      if (payload.type === 'content' && payload.version === undefined) { refresh?.(); return; }
      changed(payload);
    },
  });
}
