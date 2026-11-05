import type { RoomEntryContext } from "../../contracts/sharedEntry";
import { hasTiptapNodeType } from '../tiptap';
import type { TiptapDoc } from '../tiptap';
import type { EntryFormat, EntryFormatData } from "../../contracts/entryFormats";
import type { SessionTransport } from './transport';

export type Room = { id: string | number; name: string | null; avatar_url?: string | null };
export type RoomEntryPreview = RoomEntryContext & {
  creation_origin?: string;
  reply_participants?: Array<{ id: number; username: string; avatar_url: string | null }>;
  author?: { display_username: string; avatar_url: string | null };
  id: number;
  format: EntryFormat;
  format_data: EntryFormatData | null;
  content: TiptapDoc;
  reply_count: number;
  available: boolean;
  project?: { id: number; name: string; icon_url: string | null } | null;
};

export type RoomRound = {
  wall_id?: number;
  event_label?: string;
  event_id?: string;
  id: number;
  name: string;
  description: string | null;
  status: string;
  completed: boolean;
  submitted_count: number;
  participant_count: number;
  occurred_at: string;
};

export type RoomMessage = {
  content?: TiptapDoc | null; entry?: RoomEntryPreview | null; round_event?: RoomRound | null;
  reply_count?: number; reply_participants?: Array<{ id: number; username: string; avatar_url: string | null }>;
  id: number; body: string; created_at: string; client_nonce: string | null;
  kind: 'message' | 'post_announcement' | 'post_link';
  author: { id: number; display_username: string; avatar_url?: string | null } | null;
  masked_author: { display_username: string } | null;
};
export type RoomPage = {
  messages: RoomMessage[]; next_cursor: number | null; viewer_user_id: number;
  viewer_access?: { kind: 'member' | 'visitor'; can_send: boolean; can_paginate: boolean; history_limit: number | null };
};
type Client = Pick<SessionTransport, 'get' | 'post'>;
export function fetchRoomMessages<T extends RoomPage = RoomPage>(client: Client, id: string | number, options: { before?: number | null; after?: number; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (options.after !== undefined) query.set('after', String(options.after));
  if (options.before) query.set('before', String(options.before));
  if (options.limit) query.set('limit', String(options.limit));
  return client.get<T>(`/v2/rooms/${encodeURIComponent(id)}/chat/messages${query.size ? '?' + query.toString() : ''}`, { cache: 'no-store', signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(15000) : undefined });
}
export function sendRoomMessage<T extends RoomMessage = RoomMessage>(client: Client, id: string | number, payload: { body: string; content?: unknown; clientNonce?: string; draftId?: number }) {
  return client.post<T>(`/v2/rooms/${encodeURIComponent(id)}/chat/messages`, {
    body: payload.body,
    ...(payload.content ? { content: payload.content } : {}),
    ...(payload.clientNonce ? { client_nonce: payload.clientNonce } : {}),
    ...(payload.draftId ? { draft_id: payload.draftId } : {}),
  });
}
export function mergeRoomMessages<T extends RoomMessage>(pages: { messages: T[] }[]) {
  const messages = new Map<number, T>();
  for (const page of pages) for (const message of page.messages) messages.set(message.id, message);
  return [...messages.values()].sort((a, b) => a.id - b.id);
}

export type LiveRoomPage<T extends RoomPage = RoomPage> = T & { liveStartId: number; historyCursor: number | null };
export async function fetchLiveRoomPage<T extends RoomPage = RoomPage>(client: Client, id: string | number, previous?: LiveRoomPage<T>): Promise<LiveRoomPage<T>> {
  if (!previous || previous.viewer_access?.kind === 'visitor') {
    const page = await fetchRoomMessages<T>(client, id, { limit: 50 });
    return { ...page, liveStartId: page.messages[0]?.id ?? 1, historyCursor: page.next_cursor };
  }
  const messages: RoomMessage[] = [];
  let after = previous.liveStartId - 1;
  let page: T;
  do {
    page = await fetchRoomMessages<T>(client, id, { after, limit: 100 });
    if (page.viewer_access?.kind === 'visitor') return { ...page, liveStartId: page.messages[0]?.id ?? 1, historyCursor: null };
    messages.push(...page.messages);
    if (page.next_cursor === null || page.next_cursor <= after) break;
    after = page.next_cursor;
  } while (true);
  return { ...page, messages, liveStartId: previous.liveStartId, historyCursor: previous.historyCursor } as LiveRoomPage<T>;
}

export function createChatDraft(client: Pick<SessionTransport, 'post'>, room: string | number, nonce: string) {
  return client.post<{ id: number }>(`/v2/rooms/${encodeURIComponent(room)}/chat/drafts`, { client_nonce: nonce });
}
export function deleteChatDraft(client: Pick<SessionTransport, 'delete'>, room: string | number, id: number) {
  return client.delete<{ ok: true }>(`/v2/rooms/${encodeURIComponent(room)}/chat/drafts/${id}`);
}

/** Attachment-backed counts name entry responses, not historical Chat replies. */
export function historicalReplyCount(message: RoomMessage) {
  if (message.entry && ['image', 'audio', 'video', 'file'].some(type => hasTiptapNodeType(message.content, type))) return 0;
  return message.reply_count ?? 0;
}
