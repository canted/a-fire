import type { RoomReplySettingsPayload } from "../feedback-settings"

export type RoomPayload = {
  id: number
  name: string | null
  avatar_url?: string | null
  owner_id: number | null
  canManage: boolean
  porosity: RoomPorosity
  porosity_label: "Open" | "Visit only" | "Knock only"
  parent: { id: number; name: string | null } | null
  membership_state: "member" | "visitor" | "admitted_visitor" | "requested" | "none"
  access: {
    kind: "member" | "visitor"
    can_manage: boolean
    can_create_adjacent_room: boolean
    can_view_notes: boolean
    can_write_wall: boolean
    can_participate_rounds: boolean
  }
  viewer_invitation: RoomInvitationPayload | null
  replySettings?: RoomReplySettingsPayload
}

export type RoomInvitationPayload = {
  id: number
  room_id: number
  user: { id: number; display_username: string; avatar_url: string | null }
  invited_by: { id: number; display_username: string }
  status: string
  created_at: string
  responded_at: string | null
}

export type RoomPorosity = "open" | "masked" | "closed"

export type RoomMemberPayload = {
  id: number
  user_id: number
  display_username: string
  display_avatar_url: string | null
  avatar_url: string | null
  presence: { is_here: boolean; last_seen_at: string | null }
  location: { room_id: number | null; name: string | null; is_private: boolean }
}

export type DeleteRoomMemberPayload = {
  success: true
  member_id: number
}

export type DeleteRoomPayload = {
  success: true
  room_id: number
}

export type RoomNotificationDeliveryPayload = {
  id: number
  notification_event_id: number
  user_id: number
  user_name: string
  state: string
  created_at: string
  due_at: string | null
  sent_at: string | null
  cancelled_at: string | null
  skip_reason: string | null
  last_error: string | null
  event_type: string
  entry_id: number | null
  reply_id: string | null
  link_path: string | null
  link_label: string
  content_seen: boolean
}

export type RoomNotificationDeliveriesPayload = {
  items: RoomNotificationDeliveryPayload[]
}

export type RoomInput = {
  name?: string
  porosity?: string | null
  avatarFile?: Express.Multer.File
  removeAvatar?: boolean
}

export type SideRoomInput = { name?: string; userIds?: number[] }

export type RelationshipStatus = "pending" | "approved" | "declined"

export type InvitationStatus = "pending" | "accepted" | "declined" | "revoked"

export type KnockStatus = "pending" | "admitted" | "declined" | "revoked"
