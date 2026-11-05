import { PostHog } from "posthog-node";

let client: PostHog | null = null;

export const POSTHOG_EVENTS = {
  inviteAccepted: "invite_accepted",
  inviteCreated: "invite_created",
  communityCreated: "community_created",
  pageCreated: "page_created",
  postPublished: "post_published",
  replyPublished: "reply_published",
  reflectionCreated: "reflection_created",
  reflectionRemoved: "reflection_removed",
  pushSubscriptionEnabled: "push_subscription_enabled",
  pushSubscriptionDisabled: "push_subscription_disabled",
  notificationPreferencesUpdated: "notification_preferences_updated",
} as const;

type InviteType = "room_invite" | "new_room_invite";
type ReflectableType = "Post" | "Reply";

export function getPosthogClient(): PostHog | null {
  if (process.env.NODE_ENV !== "production" && process.env.POSTHOG_ENABLE_IN_DEV !== "true") return null;
  if (client) {
    return client;
  }

  const apiKey = process.env.POSTHOG_KEY || process.env.VITE_POSTHOG_KEY;
  if (!apiKey) {
    return null;
  }

  const host = process.env.POSTHOG_HOST || process.env.VITE_POSTHOG_HOST;
  client = new PostHog(apiKey, {
    ...(host ? { host } : {}),
    enableExceptionAutocapture: true,
  });
  return client;
}

type CaptureProperties = Record<string, unknown>;

function normalizeValue(value: unknown): unknown {
  if (typeof value === "number") return Number(value);
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return value;

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, val]) => {
    acc[key] = normalizeValue(val);
    return acc;
  }, {});
}

export function capturePosthogEvent(options: {
  distinctId: string | number;
  event: string;
  properties?: CaptureProperties;
}): void {
  try {
    const currentClient = getPosthogClient();
    if (!currentClient) return;
    currentClient.capture({
      distinctId: String(options.distinctId),
      event: options.event,
      properties: {
        environment: process.env.NODE_ENV ?? "unknown",
        analytics_version: 1,
        deployment: process.env.FLY_APP_NAME ?? "local",
        ...(options.properties ? normalizeValue(options.properties) as CaptureProperties : {}),
      },
    });
  } catch { console.warn("PostHog event capture failed"); }
}

export function capturePosthogException(options: {
  error: unknown;
  distinctId?: string | number | null;
  properties?: CaptureProperties;
}): void {
  const currentClient = getPosthogClient();
  if (!currentClient) {
    return;
  }

  try {
    currentClient.captureException(
      options.error,
      options.distinctId == null ? "server" : String(options.distinctId),
      options.properties ? (normalizeValue(options.properties) as CaptureProperties) : undefined,
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "posthog_exception_capture_failed",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
  }
}

export function captureInviteAccepted(options: {
  userId: string | number;
  inviteId: string | number;
  inviteType: InviteType;
  roomId?: string | number | null;
  boardId?: string | number | null;
  isNewUser: boolean;
}): void {
  capturePosthogEvent({
    distinctId: options.userId,
    event: POSTHOG_EVENTS.inviteAccepted,
    properties: {
      invite_id: options.inviteId,
      invite_type: options.inviteType,
      room_id: options.roomId ?? null,
      board_id: options.boardId ?? null,
      is_new_user: options.isNewUser,
    },
  });
}

export function captureInviteCreated(options: {
  userId: string | number;
  inviteId: string | number;
  inviteType: InviteType;
  roomId?: string | number | null;
}): void {
  capturePosthogEvent({
    distinctId: options.userId,
    event: POSTHOG_EVENTS.inviteCreated,
    properties: {
      invite_id: options.inviteId,
      invite_type: options.inviteType,
      room_id: options.roomId ?? null,
    },
  });
}

export function captureCommunityCreated(options: {
  userId: string | number;
  roomId: string | number;
  source?: string;
}): void {
  capturePosthogEvent({
    distinctId: options.userId,
    event: POSTHOG_EVENTS.communityCreated,
    properties: {
      room_id: options.roomId,
      source: options.source ?? "community_onboarding",
    },
  });
}

export function capturePageCreated(options: {
  userId: string | number;
  roomId?: string | number | null;
  pageId: string | number;
  source?: string;
}): void {
  capturePosthogEvent({
    distinctId: options.userId,
    event: POSTHOG_EVENTS.pageCreated,
    properties: {
      room_id: options.roomId ?? null,
      page_id: options.pageId,
      source: options.source ?? "page_tree",
    },
  });
}

export function capturePostPublished(options: {
  userId: string | number;
  entryId: string | number;
  roomId?: string | number | null;
  sourceEntryId?: number | null;
  projectId?: number | null;
  activityId?: number | null;
  content: unknown;
}): void {
  capturePosthogEvent({
    distinctId: options.userId,
    event: POSTHOG_EVENTS.postPublished,
    properties: {
      entry_id: options.entryId,
      source_entry_id: options.sourceEntryId ?? null,
      project_id: options.projectId ?? null,
      activity_id: options.activityId ?? null,
      room_id: options.roomId ?? null,
      ...summarizeContentForAnalytics(options.content),
    },
  });
}

export function captureReplyPublished(options: {
  userId: string | number;
  replyId: string | number;
  entryId?: string | number | null;
  roomId?: string | number | null;
  content: unknown;
}): void {
  capturePosthogEvent({
    distinctId: options.userId,
    event: POSTHOG_EVENTS.replyPublished,
    properties: {
      reply_id: options.replyId,
      entry_id: options.entryId ?? null,
      room_id: options.roomId ?? null,
      ...summarizeContentForAnalytics(options.content),
    },
  });
}

export function captureReflectionCreated(options: {
  userId: string | number;
  reflectionId: string | number;
  reflectableType: ReflectableType;
  reflectableId: string | number;
  pageId: string | number;
  entryId?: string | number | null;
  boardId?: string | number | null;
  roomId?: string | number | null;
}): void {
  capturePosthogEvent({
    distinctId: options.userId,
    event: POSTHOG_EVENTS.reflectionCreated,
    properties: reflectionProperties(options),
  });
}

export function captureReflectionRemoved(options: {
  userId: string | number;
  reflectableType: ReflectableType;
  reflectableId: string | number;
  pageId: string | number;
  entryId?: string | number | null;
  boardId?: string | number | null;
  roomId?: string | number | null;
}): void {
  capturePosthogEvent({
    distinctId: options.userId,
    event: POSTHOG_EVENTS.reflectionRemoved,
    properties: reflectionProperties(options),
  });
}

export function capturePushSubscriptionEnabled(options: { userId: string | number }): void {
  capturePosthogEvent({
    distinctId: options.userId,
    event: POSTHOG_EVENTS.pushSubscriptionEnabled,
    properties: { notification_permission: "granted" },
  });
}

export function capturePushSubscriptionDisabled(options: { userId: string | number }): void {
  capturePosthogEvent({
    distinctId: options.userId,
    event: POSTHOG_EVENTS.pushSubscriptionDisabled,
  });
}

export function captureNotificationPreferencesUpdated(options: {
  userId: string | number;
  roomId: string | number;
  notificationType: string;
}): void {
  capturePosthogEvent({
    distinctId: options.userId,
    event: POSTHOG_EVENTS.notificationPreferencesUpdated,
    properties: {
      room_id: options.roomId,
      notification_type: options.notificationType,
    },
  });
}

export function summarizeContentForAnalytics(content: unknown) {
  const nodes = content && typeof content === "object" ? (content as { content?: unknown }).content : null;
  const topLevelNodes = Array.isArray(nodes) ? nodes : [];
  const attachmentTypes = new Set<string>();
  let attachmentCount = 0;
  let textCharCount = 0;
  let hasLink = false;

  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const record = node as { type?: unknown; text?: unknown; attrs?: unknown; marks?: unknown; content?: unknown };
    const type = typeof record.type === "string" ? record.type : "";
    if (typeof record.text === "string") {
      textCharCount += record.text.length;
    }
    if (type === "image") {
      attachmentTypes.add("image");
      attachmentCount += 1;
    }
    if (type === "audio") {
      attachmentTypes.add("audio");
      attachmentCount += 1;
    }
    if (type === "video") {
      attachmentTypes.add("video");
      attachmentCount += 1;
    }
    const attrs = record.attrs && typeof record.attrs === "object" ? (record.attrs as Record<string, unknown>) : {};
    if (typeof attrs.href === "string" || (typeof attrs.src === "string" && type !== "image")) {
      hasLink = true;
    }
    const marks = Array.isArray(record.marks) ? record.marks : [];
    if (marks.some((mark) => mark && typeof mark === "object" && (mark as { type?: unknown }).type === "link")) {
      hasLink = true;
    }
    if (Array.isArray(record.content)) {
      record.content.forEach(visit);
    }
  };

  topLevelNodes.forEach(visit);
  const attachmentTypesList = Array.from(attachmentTypes).sort();

  return {
    content_block_count: topLevelNodes.length,
    text_char_count: textCharCount,
    attachment_count: attachmentCount,
    attachment_types: attachmentTypesList,
    has_audio: attachmentTypes.has("audio"),
    has_image: attachmentTypes.has("image"),
    has_video: attachmentTypes.has("video"),
    has_link: hasLink,
  };
}

function reflectionProperties(options: {
  reflectionId?: string | number;
  reflectableType: ReflectableType;
  reflectableId: string | number;
  pageId: string | number;
  entryId?: string | number | null;
  boardId?: string | number | null;
  roomId?: string | number | null;
}) {
  return {
    ...(options.reflectionId ? { reflection_id: options.reflectionId } : {}),
    reflectable_type: options.reflectableType,
    reflectable_id: options.reflectableId,
    page_id: options.pageId,
    entry_id: options.entryId ?? (options.reflectableType === "Post" ? options.reflectableId : null),
    board_id: options.boardId ?? null,
    room_id: options.roomId ?? null,
  };
}

export async function shutdownPosthog(): Promise<void> {
  if (!client) {
    return;
  }
  await client.shutdown();
  client = null;
}
