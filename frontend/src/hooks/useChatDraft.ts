import { useEffect } from "react";
import { useRoomDraft } from "./useRooms";
import { normalizeChatDraft } from "../lib/chatDraftPolicy";
import { releaseChatFile } from "../lib/chatFiles";

/** Chat policy over the existing session-scoped store; Reply drafts stay untouched. */
export function useChatDraft(room: string, viewer?: number) {
  const draft = useRoomDraft(room, viewer);
  const value = normalizeChatDraft(draft);
  useEffect(() => {
    const previous = draft.read();
    const normalized = normalizeChatDraft(previous);
    if (normalized === previous) return;
    draft.update(normalized);
    releaseChatFile(previous.attachment);
    if (
      previous.pending?.attachment &&
      previous.pending.attachment.id !== previous.attachment?.id
    )
      releaseChatFile(previous.pending?.attachment);
  }, [
    draft.attachment,
    draft.staging,
    draft.pending,
    draft.prefix,
    draft.operation,
    room,
    viewer,
  ]);
  return {
    ...value,
    read: () => normalizeChatDraft(draft.read()),
    update: draft.update,
  };
}
