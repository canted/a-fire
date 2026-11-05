import type { RoomEntryContext } from "../../contracts/sharedEntry";
import type { SessionTransport } from "./transport";
type ApiClient = Pick<SessionTransport, "get" | "post" | "patch" | "delete" | "put">;

export interface EntryListItem {
  id: string;
  title: string;
  body?: string;
  createdAt?: string;
  publishedAt?: string | null;
  activeAt?: string;
  replyCount?: number;
  displayUsername?: string;
  displayAvatarUrl?: string | null;
  mediaType?: "audio" | "video" | "image";
}

export async function fetchEntries(client: ApiClient, roomId?: string): Promise<EntryListItem[]> {
  const path = roomId ? `/v1/entries?roomId=${encodeURIComponent(roomId)}` : "/v1/entries";
  return client.get<EntryListItem[]>(path);
}

import { plainTextFromTiptap, type TiptapDoc } from "../tiptap";
import type { EntrySubjectPayload } from "../../contracts/entrySubjects";
import type { LinkPreviewAttachment, LinkPreviewAttachmentInput } from "../../contracts/linkPreviews";
import type { ReflectionSummary } from "../../contracts/entries";
import { normalizeFeedbackRequest, type FeedbackRequest, type FeedbackType } from "../feedback";
import type { EntryFormat, EntryFormatData } from "../../contracts/entryFormats";

export type EntryUser = {
  id: number;
  username: string;
  avatar_url?: string | null;
  display_username?: string;
  display_avatar_url?: string | null;
};

export type EntryNavigationLink = {
  id: number;
  created_at?: string;
  published_at?: string | null;
};

export type EntryShow = RoomEntryContext & {
  revision?: number;
  id: number;
  status: string;
  room_id?: number | null;
  board?: { id: number; name: string } | null;
  room?: { id: number; name: string | null; avatar_url?: string | null } | null;
  project_id?: number | null;
  room_project?: { name: string } | null;
  keep_project_id?: number;
  can_keep_replies?: boolean;
  source_entry_id?: number;
  project?: { id: number; name: string; icon_url?: string | null } | null;
  round_id?: number | null;
  round?: { id: number; name: string } | null;
  created_at?: string;
  published_at?: string | null;
  display_username?: string;
  display_avatar_url?: string | null;
  user: EntryUser;
  content: TiptapDoc;
  format: EntryFormat;
  format_data?: EntryFormatData | null;
  subject?: EntrySubjectPayload | null;
  feedback_request: FeedbackRequest;
  can_edit_feedback_request?: boolean;
  can_edit?: boolean;
  can_delete?: boolean;
  link_preview?: LinkPreviewAttachment | null;
  reflections?: ReflectionSummary[];
  previous_entry?: EntryNavigationLink | null;
  next_entry?: EntryNavigationLink | null;
  previous_author_entry?: EntryNavigationLink | null;
  next_author_entry?: EntryNavigationLink | null;
  previous_project_entry?: EntryNavigationLink | null;
  next_project_entry?: EntryNavigationLink | null;
  previous_round_entry?: EntryNavigationLink | null;
  next_round_entry?: EntryNavigationLink | null;
  locked?: boolean;
  provenance?: {
    source_message_id: number | null;
    saved_by: { id: number; display_username: string } | null;
    label: string;
  } | null;
  round_attribution?: { label: string; cover_contributor_id?: number | null } | null;
  viewer_access?: { kind: "member" | "visitor"; can_write: boolean; can_reply: boolean; can_withdraw?: boolean };
};

export type DeleteEntryResponse = {
  success: true;
  entry_id: number;
  room_id: number;
  current_entry_id: number | null;
};

export type Reply = {
  revision?: number;
  id: number | string;
  status?: string;
  created_at?: string;
  published_at?: string | null;
  user: EntryUser | null;
  display_username?: string;
  display_avatar_url?: string | null;
  feedback_type?: FeedbackType | null;
  content?: TiptapDoc;
  link_preview?: LinkPreviewAttachment | null;
  reflections?: ReflectionSummary[];
};

export type Pagination = {
  page: number;
  per_page: number;
  next_page: number | null;
};

export type RepliesPayload = {
  data: Reply[];
  pagination: Pagination;
};

export type EntryShowResponse = {
  entry: EntryShow;
  replies: RepliesPayload;
};

export type ReflectionsResponse = {
  reflections: ReflectionSummary[];
};

export async function fetchEntry(client: ApiClient, postId: string, page?: number): Promise<EntryShowResponse> {
  const search = page ? `?page=${page}` : "";
  const response = await client.get<EntryShowResponse>(`/v1/entries/${postId}${search}`);
  return normalizeEntryShowResponse(response);
}

export async function fetchReplies(client: ApiClient, postId: string, page: number): Promise<RepliesPayload> {
  const response = await client.get<RepliesPayload>(`/v1/entries/${postId}/replies?page=${page}`);
  return {
    ...response,
    data: response.data.map((reply) => ({
      ...reply,
      reflections: normalizeReflections(reply.reflections),
    })),
  };
}

export type CreateReplyPayload = {
  expected_revision?: number;
  content?: TiptapDoc;
  status?: string;
  feedback_type?: FeedbackType | null;
  link_preview?: LinkPreviewAttachmentInput | null;
};

export async function createReply(client: ApiClient, postId: string, payload: CreateReplyPayload): Promise<Reply> {
  const reply = await client.post<Reply>(`/v1/entries/${postId}/replies`, { reply: payload });
  return { ...reply, reflections: normalizeReflections(reply.reflections) };
}

export async function updateReply(
  client: ApiClient,
  postId: string,
  replyId: string | number,
  payload: CreateReplyPayload,
): Promise<Reply> {
  const reply = await client.patch<Reply>(`/v1/entries/${postId}/replies/${replyId}`, { reply: payload });
  return { ...reply, reflections: normalizeReflections(reply.reflections) };
}

export async function publishReply(
  client: ApiClient,
  postId: string,
  replyId: string | number,
  payload: CreateReplyPayload = {},
): Promise<Reply> {
  const reply = await client.post<Reply>(`/v1/entries/${postId}/replies/${replyId}/publish`, { reply: payload });
  return { ...reply, reflections: normalizeReflections(reply.reflections) };
}

export async function updateEntryFeedbackRequest(
  client: ApiClient,
  postId: string | number,
  feedbackRequest: FeedbackRequest,
): Promise<{ feedback_request: FeedbackRequest; can_edit_feedback_request?: boolean }> {
  const response = await client.patch<{ feedback_request: FeedbackRequest; can_edit_feedback_request?: boolean }>(
    `/v1/entries/${postId}/feedback-request`,
    { feedback_request: feedbackRequest },
  );
  return { ...response, feedback_request: normalizeFeedbackRequest(response.feedback_request) };
}

export async function updateEntryContent(
  client: ApiClient,
  postId: string | number,
  content: TiptapDoc,
  expectedRevision: number,
): Promise<unknown> {
  return client.put(`/v1/entries/${postId}/content`, {
    content,
    expected_revision: expectedRevision,
    format: "text",
    format_data: { text: plainTextFromTiptap(content), gradient: "fire" },
  });
}

export async function deleteChatSavedEntry(
  client: ApiClient,
  postId: string | number,
): Promise<DeleteEntryResponse> {
  return client.delete<DeleteEntryResponse>(`/v1/entries/${postId}`);
}

export async function createReflection(
  client: ApiClient,
  reflectable: { type: "post" | "reply"; id: string | number },
  pageId: string | number,
): Promise<ReflectionSummary[]> {
  const path =
    reflectable.type === "post"
      ? `/v1/entries/${reflectable.id}/reflections`
      : `/v1/replies/${reflectable.id}/reflections`;
  const payload = { page_id: pageId };
  const response = await client.post<ReflectionsResponse>(path, payload);
  return normalizeReflections(response.reflections);
}

export async function deleteReflection(
  client: ApiClient,
  reflectable: { type: "post" | "reply"; id: string | number },
  pageId: string | number,
): Promise<ReflectionSummary[]> {
  const path =
    reflectable.type === "post"
      ? `/v1/entries/${reflectable.id}/reflections/${pageId}`
      : `/v1/replies/${reflectable.id}/reflections/${pageId}`;
  const response = await client.delete<ReflectionsResponse>(path);
  return normalizeReflections(response.reflections);
}

function normalizeEntryShowResponse(response: EntryShowResponse): EntryShowResponse {
  return {
    ...response,
    entry: {
      ...response.entry,
      feedback_request: normalizeFeedbackRequest(response.entry.feedback_request),
      reflections: normalizeReflections(response.entry.reflections),
    },
    replies: {
      ...response.replies,
      data: response.replies.data.map((reply) => ({
        ...reply,
        reflections: normalizeReflections(reply.reflections),
      })),
    },
  };
}

export function normalizeReflections(reflections?: any[]): ReflectionSummary[] {
  if (!Array.isArray(reflections)) return [];

  return reflections
    .map((reflection) => {
      if (!reflection) return null;
      if ("pageId" in reflection || "page_id" in reflection) {
        return {
          pageId: (reflection.pageId ?? reflection.page_id ?? reflection.page?.id) as number | string,
          pageTitle: (reflection.pageTitle ?? reflection.page_title ?? reflection.page?.title ?? null) as string | null,
          pageIcon: (reflection.pageIcon ?? reflection.page_icon ?? reflection.page?.icon ?? null) as string | null,
          count: Number(reflection.count ?? reflection.page_count ?? reflection.counts ?? 1),
          mine: Boolean(reflection.mine ?? reflection.mine?.valueOf?.()),
        };
      }
      return null;
    })
    .filter(Boolean) as ReflectionSummary[];
}
