import type { RoomDraft } from "./chatComposition";

/** Retire obsolete local Chat media state once, keeping text and text-only retries. */
export function normalizeChatDraft(draft: RoomDraft): RoomDraft {
  if (
    !draft.attachment &&
    !draft.staging &&
    !draft.pending?.attachment &&
    !draft.prefix &&
    (!draft.operation || draft.operation.stage === "sending")
  )
    return draft;
  return {
    ...draft,
    attachment: undefined,
    staging: undefined,
    prefix: undefined,
    pending: draft.pending?.attachment || draft.staging ? null : draft.pending,
    operation:
      draft.operation?.stage === "sending" ? draft.operation : undefined,
    revision: draft.revision + 1,
  };
}
