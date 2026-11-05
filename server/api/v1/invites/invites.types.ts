export type InviteType = "room_invite" | "new_room_invite"
export type InviteStatus = "active" | "expired" | "used"

export type InvitePayload = {
  id: number
  email: string | null
  recipient_label: string
  invite_type: InviteType
  room: { id: number; name: string | null } | null
  invited_by: { id: number; username: string }
  status: InviteStatus
  expires_at: string
  used_at: string | null
  created_at: string
}

export type InviteIndexResponse = {
  invites: InvitePayload[]
  permissions: { new_room_invite_allowed: boolean }
}

export type InviteSuggestionPayload = {
  invitee_membership_id: number
  display_name: string
  shared_communities: Array<{ id: number; name: string | null }>
}

export type InviteSuggestionsResponse = {
  suggestions: InviteSuggestionPayload[]
}
