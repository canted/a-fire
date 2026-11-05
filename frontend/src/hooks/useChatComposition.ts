import { useState } from "react";
import { useMentionTargets } from "./useMentionTargets";
import { mentionDocument } from "../lib/plainMentionDraft";
import { randomUuid } from "../lib/randomId";
import { ApiError } from "../lib/api/transport";
import { acknowledgeChatSend } from "../lib/chatComposition";
import type { useRoom } from "./useRooms";
import type { useChatDraft } from "./useChatDraft";

export function useChatComposition(
  id: string,
  draft: ReturnType<typeof useChatDraft>,
  room: ReturnType<typeof useRoom>,
  sent: () => void,
  enabled: boolean,
) {
  const [error, setError] = useState<string | null>(null);
  const stage = draft.operation?.stage ?? "idle";
  const mentions = useMentionTargets(id, enabled);
  async function send() {
    if (draft.read().operation || !enabled) return;
    const current = draft.read();
    if (!current.pending && !current.text.trim()) return;
    const owner = Symbol("chat-send");
    draft.update({ operation: { owner, stage: "sending" } });
    setError(null);
    const pending = current.pending ?? {
      body: current.text.trim(),
      content: mentionDocument(current),
      nonce: randomUuid(),
      revision: current.revision,
    };
    draft.update({ pending });
    try {
      await room.send.trigger({
        body: pending.body,
        content: pending.content,
        clientNonce: pending.nonce,
      });
      draft.update((value) => acknowledgeChatSend(value, pending));
      sent();
    } catch (reason) {
      // Keep uncertain requests frozen so retry publishes the same logical send.
      // Definitive rejection permits editing; uncertain delivery keeps the original nonce.
      if (
        reason instanceof ApiError &&
        reason.status >= 400 &&
        reason.status < 500 &&
        reason.status !== 408
      )
        draft.update({ pending: null });
      setError(
        reason instanceof ApiError
          ? reason.message
          : "Could not confirm delivery. Check your connection and retry the same message.",
      );
    } finally {
      draft.update((current) =>
        current.operation?.owner === owner ? { operation: undefined } : {},
      );
    }
  }
  return {
    mentions,
    error,
    setError,
    stage,
    busy: stage !== "idle",
    send,
  };
}
