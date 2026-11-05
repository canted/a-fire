import type { TiptapDoc } from "../tiptap";
import { defaultTiptapDoc } from "../tiptap";
import type { EntryDraftResponse } from "../../contracts/entryDraft";
import type { SessionTransport } from "./transport";
type ApiClient = Pick<SessionTransport, "get" | "post" | "put" | "patch">;
import type { LinkPreviewAttachmentInput } from "../../contracts/linkPreviews";
import type { EntrySubjectPayload } from "../../contracts/entrySubjects";
import { normalizeFeedbackRequest, type FeedbackRequest } from "../feedback";
import type { EntryFormat, EntryFormatData } from "../../contracts/entryFormats";

export type CreateDraftEntryOptions = {
  format?: EntryFormat;
  roundId?: string | number | null;
  creationOrigin?: "chat" | "round_activity_cover" | "round_activity_response" | null;
};

export async function fetchEntryDraft(apiClient: ApiClient, postId: string | number) {
  return normalizeDraft(await apiClient.get<EntryDraftResponse>(`/v1/entries/${postId}/draft`));
}

export async function updateDraftEntryRound(apiClient: ApiClient, postId: string | number, activityId: string | number | null) {
  return normalizeDraft(
    await apiClient.patch<EntryDraftResponse>(`/v1/entries/${postId}/round`, {
      round_id: activityId,
    }),
  );
}

export async function saveEntryContent(apiClient: ApiClient,
  postId: string | number,
  content: TiptapDoc,
  subject?: EntrySubjectPayload | null,
  linkPreview?: LinkPreviewAttachmentInput | null,
  feedbackRequest?: FeedbackRequest | null,
  format?: EntryFormat,
  formatData?: EntryFormatData | null,
  expectedRevision?: number,
) {
  return normalizeDraft(await apiClient.put<EntryDraftResponse>(`/v1/entries/${postId}/content`, {
    content: content || defaultTiptapDoc,
    ...(expectedRevision !== undefined ? { expected_revision: expectedRevision } : {}),
    subject,
    link_preview: linkPreview,
    ...(feedbackRequest ? { feedback_request: feedbackRequest } : {}),
    ...(format ? { format, format_data: formatData ?? null } : {}),
  }));
}

export async function publishEntry(apiClient: ApiClient, postId: string | number) {
  return normalizeDraft(await apiClient.post<EntryDraftResponse>(`/v1/entries/${postId}/publish`));
}

function normalizeDraft(draft: EntryDraftResponse): EntryDraftResponse {
  return {
    ...draft,
    feedback_request: normalizeFeedbackRequest(draft.feedback_request),
  };
}
