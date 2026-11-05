import type { SessionTransport } from "./transport";
type ApiClient = Pick<SessionTransport, "get" | "post">;
import { Notice, NoticesPayload, NoticeType } from "./noticeTypes";
import { appPath, appRoutes } from "../appRoutes";
import type { TiptapDoc } from "../tiptap";

export const NOTICES_PAGE_SIZE = 10;

export type NotificationInboxRecord = {
  id: string;
  deliveryState: string;
  deliveredAt?: string | null;
  contentSeen?: boolean;
  bundle?: {
    type: "reply";
    key: string;
    itemIds: string[];
    replyCount: number;
    actors: Array<{ username: string; avatarUrl?: string | null; unseen?: boolean }>;
  };
  notificationEvent: {
    id: string;
    eventType: string;
    actorUsername?: string | null;
    actorAvatarUrl?: string | null;
    roomName?: string | null;
    roomAvatarUrl?: string | null;
    targetPath?: string | null;
    entryId?: string | null;
    replyId?: string | null;
    postAuthorUsername?: string | null;
    postCreatedAt?: string | null;
    postPublishedAt?: string | null;
    payload: Record<string, unknown>;
    postContent?: TiptapDoc | null;
    replyContent?: TiptapDoc | null;
    createdAt: string;
  };
};

function toNoticeType(eventType: string | null | undefined): NoticeType {
  const normalized = (eventType || "").toLowerCase();
  if (normalized.includes("chat")) return "chat";
  if (normalized.startsWith("circle_")) return "circle";
  if ((normalized.startsWith("activity_") || normalized.startsWith("round_"))) return "activity";
  if (normalized.includes("introduction")) return "introduction";
  if (normalized.includes("reply")) return "reply";
  if (normalized.includes("mention")) return "mention";
  if (normalized === "post_created") return "post";
  return "activity";
}

function extractEntryId(targetPath?: string | null): string | null {
  if (!targetPath) return null;
  // Match both /post/:id and /api/posts/:id
  const match = targetPath.match(/\/(?:posts?|entries)\/([^/?#]+)/i);
  return match ? match[1] : null;
}

function extractReplyId(targetPath?: string | null): string | null {
  if (!targetPath) return null;
  const match = targetPath.match(/#reply-([^/?#]+)/i);
  return match ? match[1] : null;
}

function stringId(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return null;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveTargetUrl(targetPath: string | null | undefined, postId: string | null, replyId: string | null) {
  if (postId && replyId) return `${appRoutes.entry(postId)}#reply-${replyId}`;
  if (targetPath) return appPath(targetPath);
  return postId ? appRoutes.entry(postId) : null;
}

export function mapNoticeRecord(record: NotificationInboxRecord): Notice {
  const event = record.notificationEvent;
  const postId = event.entryId || extractEntryId(event.targetPath);
  const replyId = event.replyId || stringId(event.payload?.replyId) || stringId(event.payload?.reply_id) || extractReplyId(event.targetPath);
  const excerpt = typeof event.payload?.excerpt === "string" ? event.payload.excerpt : "";
  const introductionNote = typeof event.payload?.note === "string" ? event.payload.note : "";
  const otherRecipientName = typeof event.payload?.otherRecipientName === "string" ? event.payload.otherRecipientName : null;
  const savedRoundName = event.payload?.activity_name ?? event.payload?.round_name;
  const activityName = typeof savedRoundName === "string" ? savedRoundName : null;
  const activityMilestone = typeof event.payload?.milestone === "string" ? event.payload.milestone : null;
  const noticeType = toNoticeType(event.eventType);
  const replyBundleKey = noticeType === "reply" && postId ? `reply-post:${postId}` : null;
  const replyActors = record.bundle?.actors.map((actor) => ({ name: actor.username, avatarUrl: actor.avatarUrl ?? null }));
  const primaryActor = replyActors?.[0];
  return {
    id: record.id,
    type: noticeType,
    eventType: event.eventType,
    source: primaryActor?.name || event.actorUsername || "Someone",
    sourceAvatarUrl: primaryActor?.avatarUrl ?? event.actorAvatarUrl ?? null,
    bundleKey: record.bundle?.key ?? replyBundleKey,
    bundledNoticeIds: record.bundle?.itemIds ?? [record.id],
    replyCount: record.bundle?.replyCount,
    replyActors,
    roomName: event.roomName ?? null,
    roomAvatarUrl: event.roomAvatarUrl ?? null,
    message: noticeType === "introduction" ? introductionNote : excerpt,
    otherRecipientName,
    introductionThroughPost: noticeType === "introduction" ? Boolean(event.payload?.throughPost) : false,
    activityName,
    activityMilestone,
    targetUrl: resolveTargetUrl(event.targetPath, postId, replyId),
    entryId: postId,
    replyId,
    postAuthorName: event.postAuthorUsername ?? null,
    postCreatedAt: parseDate(event.postCreatedAt),
    postPublishedAt: parseDate(event.postPublishedAt),
    content: event.postContent ?? null,
    replyContent: event.replyContent ?? null,
    createdAt: new Date(event.createdAt),
    contentSeen: Boolean(record.contentSeen),
  };
}

type NotificationInboxPayload = {
  items: NotificationInboxRecord[];
  highlightAfter: string;
  visitSeenThroughAt: string;
  nextCursor: string | null;
};

type FetchNoticesOptions = {
  limit?: number;
  cursor?: string | null;
};

export async function fetchNotices(client: ApiClient, { limit = NOTICES_PAGE_SIZE, cursor }: FetchNoticesOptions = {}): Promise<NoticesPayload> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);

  const response = await client.get<NotificationInboxPayload>(`/v1/notices?${params.toString()}`);
  return {
    items: response.items.map(mapNoticeRecord),
    highlightAfter: new Date(response.highlightAfter),
    visitSeenThroughAt: new Date(response.visitSeenThroughAt),
    nextCursor: response.nextCursor,
  };
}

export async function markNoticesSeenThrough(client: ApiClient, seenThroughAt: string): Promise<void> {
  await client.post<void>("/v1/notices/seen-through", { seenThroughAt });
}
export function markNoticesSeen(client: ApiClient, noticeIds: string[]) {
  return client.post<void>('/v1/notices/seen', { noticeIds: noticeIds.map(Number) });
}
export function markAllContentSeen(client: ApiClient) {
  return client.post<{ total: number; entries: number; replies: number }>('/v1/unseen/seen-all');
}
