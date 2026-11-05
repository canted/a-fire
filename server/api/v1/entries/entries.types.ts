import type { RoomAccessKind } from "../rooms/room-access.service"
import type { FeedbackRequestPayload } from "../feedback-settings"
import type { LinkPreviewAttachmentPayload } from "../link-previews/link-preview.types"
import type { EntryFormat, EntryFormatData } from "./entry-formats"
import type { EntrySubjectPayload } from "./entry-subjects"

export type MembershipMap = Map<string, { displayUsername: string; displayAvatarUrl: string | null }>

export type EntryUser = {
  id: number
  username: string
  avatar_url?: string | null
  display_username?: string
  display_avatar_url?: string | null
}

export type ReplyPayload = {
  id: number
  status: string
  created_at?: string
  published_at?: string | null
  user: EntryUser | null
  display_username?: string
  display_avatar_url?: string | null
  feedback_type?: string | null
  content?: unknown
  link_preview?: LinkPreviewAttachmentPayload | null
  reflections?: { page_id: number; page_title: string | null; page_icon: string | null; count: number; mine: boolean }[]
}

export type EntryNavigationLink = {
  id: number
  created_at?: string
  published_at?: string | null
}

export type EntryShow = {
  revision?: number;
  id: number
  status: string
  room_id?: number | null
  room?: { id: number; name: string | null; avatar_url?: string | null } | null
  project_id?: number | null
  project?: { id: number; name: string; icon_url?: string | null } | null
  can_keep_replies?: boolean
  room_project?: { name: string } | null;
  keep_project_id?: number
  source_entry_id?: number
  round_id?: number | null
  round?: { id: number; name: string } | null
  created_at?: string
  published_at?: string | null
  display_username?: string
  display_avatar_url?: string | null
  user: EntryUser
  content: unknown
  format: EntryFormat
  format_data?: EntryFormatData
  subject?: EntrySubjectPayload | null
  feedback_request: FeedbackRequestPayload
  can_edit_feedback_request?: boolean
  can_edit?: boolean
  can_delete?: boolean
  link_preview?: LinkPreviewAttachmentPayload | null
  reflections?: { page_id: number; page_title: string | null; page_icon: string | null; count: number; mine: boolean }[]
  previous_entry?: EntryNavigationLink | null
  next_entry?: EntryNavigationLink | null
  previous_author_entry?: EntryNavigationLink | null
  next_author_entry?: EntryNavigationLink | null
  previous_project_entry?: EntryNavigationLink | null
  next_project_entry?: EntryNavigationLink | null
  previous_round_entry?: EntryNavigationLink | null
  next_round_entry?: EntryNavigationLink | null
  locked?: boolean
  provenance?: {
    source_message_id: number | null
    saved_by: { id: number; display_username: string } | null
    label: string
  } | null
  round_attribution?: { label: string; cover_contributor_id?: number | null } | null
  viewer_access?: { kind: RoomAccessKind; can_write: boolean; can_reply: boolean; can_withdraw?: boolean }
}

export type EntryShowResponse = {
  entry: EntryShow
  replies: {
    data: ReplyPayload[]
    pagination: { page: number; per_page: number; next_page: number | null }
  }
}

export type EntryListItem = {
  id: string
  title: string
  body?: string
  createdAt?: string
  publishedAt?: string | null
  activeAt?: string
  replyCount?: number
  displayUsername?: string
  displayAvatarUrl?: string | null
  mediaType?: "audio" | "video" | "image"
}

export type DeleteLockedChatEntryPayload = {
  success: true
  entry_id: number
  room_id: number
  current_entry_id: number | null
}

export type EntryFeedbackRequestInput = {
  reply_mode?: unknown
  replyMode?: unknown
  requested_feedback_types?: unknown
  requestedFeedbackTypes?: unknown
  idea_guidance?: unknown
  ideaGuidance?: unknown
}
