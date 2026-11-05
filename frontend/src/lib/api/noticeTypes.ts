import type { TiptapDoc } from "../tiptap";

export type NoticeType = "post" | "reply" | "mention" | "introduction" | "chat" | "circle" | "activity";

export interface Notice {
  id: string;
  type: NoticeType;
  eventType?: string;
  source: string;
  sourceAvatarUrl?: string | null;
  bundleKey?: string | null;
  bundledNoticeIds?: string[];
  replyCount?: number;
  replyActors?: Array<{ name: string; avatarUrl?: string | null }>;
  roomName?: string | null;
  roomAvatarUrl?: string | null;
  message: string;
  otherRecipientName?: string | null;
  introductionThroughPost?: boolean;
  activityName?: string | null;
  activityMilestone?: string | null;
  targetUrl?: string | null;
  entryId?: string | null;
  replyId?: string | null;
  postAuthorName?: string | null;
  postCreatedAt?: Date | null;
  postPublishedAt?: Date | null;
  content?: TiptapDoc | null;
  replyContent?: TiptapDoc | null;
  createdAt: Date;
  contentSeen: boolean;
}

export type NoticesPayload = {
  items: Notice[];
  highlightAfter: Date;
  visitSeenThroughAt: Date;
  nextCursor: string | null;
};
