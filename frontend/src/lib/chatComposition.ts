import type { MentionSpan } from "./plainMentionDraft";
import type { TiptapDoc, TiptapNode } from "./tiptap";

export type ChatAttachment = {
  id: string;
  uri: string;
  name: string;
  type: string;
  size: number;
  file?: File;
  width?: number;
  height?: number;
};
export type PendingChatSend = {
  body: string;
  content: TiptapDoc;
  nonce: string;
  revision: number;
  attachment?: ChatAttachment;
};
export type RoomDraft = {
  operation?: { owner: symbol; stage: "uploading" | "sending" | "removing" };
  prefix?: TiptapDoc;
  text: string;
  mentions: MentionSpan[];
  revision: number;
  attachment?: ChatAttachment;
  pending: PendingChatSend | null;
  staging?: {
    nonce: string;
    id?: number;
    node?: TiptapNode;
    blockId: string;
    uploadAttempted?: boolean;
    serverRevision?: number;
  };
  offset: number;
  distanceFromStart: number | null;
  composerHeight: number;
  anchor?: { id: number; top: number };
};
export const emptyRoomDraft = (): RoomDraft => ({
  text: "",
  mentions: [],
  revision: 0,
  pending: null,
  offset: 0,
  distanceFromStart: null,
  composerHeight: 39.36,
});

/** Async completion belongs to the originating snapshot, never a newer edit. */
export function acknowledgeChatSend(
  current: RoomDraft,
  pending: PendingChatSend,
): Partial<RoomDraft> {
  if (current.pending?.nonce !== pending.nonce) return {};
  return current.revision === pending.revision
    ? {
        prefix: undefined,
        text: "",
        mentions: [],
        attachment: undefined,
        staging: undefined,
        pending: null,
        revision: current.revision + 1,
        composerHeight: 39.36,
      }
    : {
        pending: null,
        staging: undefined,
        ...(current.attachment?.id === pending.attachment?.id
          ? { attachment: undefined }
          : {}),
      };
}
