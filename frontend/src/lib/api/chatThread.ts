import { plainTextFromTiptap } from '../tiptap';
import type { SessionTransport } from "./transport";
import type { TiptapDoc } from "../tiptap";
import type { RoomMessage } from "./room";

export type ChatReplyPayload = {
  id: number;
  status?: string;
  created_at?: string;
  published_at?: string | null;
  display_username?: string;
  display_avatar_url?: string | null;
  user: { id: number; username: string; avatar_url?: string | null; display_username?: string; display_avatar_url?: string | null } | null;
  content?: TiptapDoc;
};

export function fetchChatReplies(client: Pick<SessionTransport, 'get'>, roomId: string | number, messageId: string | number, after?: number) {
  return client.get<{ message_id: number; replies: ChatReplyPayload[]; next_cursor: number | null }>(
    `/v2/rooms/${roomId}/chat/messages/${messageId}/replies${after === undefined ? "" : `?after=${after}`}`,
    { cache: "no-store" },
  );
}

export function fetchThreadMessage<T extends RoomMessage = RoomMessage>(client: Pick<SessionTransport, 'get'>, room: string | number, message: string | number) {
  return client.get<T>(`/v2/rooms/${room}/chat/messages/${message}`, { cache: 'no-store' });
}

/** Shared display adapter for historical Chat replies and active entry replies. */
export function replyAsRoomMessage(reply: Omit<ChatReplyPayload, 'id'> & { id: number | string }): RoomMessage {
  const id = Number(reply.id);
  return { id, kind: 'message', client_nonce: null, created_at: reply.published_at ?? reply.created_at ?? '',
    body: plainTextFromTiptap(reply.content), content: reply.content,
    author: { id: reply.user?.id ?? -id, display_username: reply.display_username ?? reply.user?.display_username ?? reply.user?.username ?? 'Unknown', avatar_url: reply.display_avatar_url ?? reply.user?.display_avatar_url ?? reply.user?.avatar_url }, masked_author: null };
}
