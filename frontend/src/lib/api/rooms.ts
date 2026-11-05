import type { SessionTransport } from "./transport";
type ApiClient = Pick<SessionTransport, "get" | "post" | "patch" | "delete" | "put">;
import { normalizeRoomReplySettings, type RoomReplySettings } from "../feedback";

export type RoomPayload = {
  id: number;
  name: string | null;
  avatar_url?: string | null;
  owner_id: number | null;
  canManage?: boolean;
  porosity: RoomPorosity;
  porosity_label?: RoomPorosityLabel;
  parent?: RoomReference | null;
  access?: RoomAccess;
  membership_state?: RoomMembershipState;
  viewer_invitation?: RoomMemberInvitation | null;
  room_id?: number | null;
  replySettings?: RoomReplySettings;
};

export type RoomPorosity = "open" | "masked" | "closed";

export type RoomPorosityLabel = "Open" | "Visit only" | "Knock only";

export type RoomMembershipState = "member" | "admitted_visitor" | "visitor" | "requested" | "none";

export type RoomReference = {
  id: number;
  name: string | null;
};

export type RoomAccess = {
  kind: "member" | "visitor";
  can_manage: boolean;
  can_create_adjacent_room: boolean;
  can_view_notes: boolean;
  can_write_wall: boolean;
  can_participate_rounds: boolean;
};

export type RoomMember = {
  id: number;
  user_id?: number;
  display_username: string;
  display_avatar_url?: string | null;
  avatar_url?: string | null;
  presence?: {
    is_here: boolean;
    last_seen_at: string | null;
  };
  location?: {
    room_id: number | null;
    name: string;
    is_private: boolean;
  };
};

export type RoomMembersResponse = {
  members: RoomMember[];
};

export type SideRoomViewerState = "member" | "admitted_visitor" | "invited" | "visitor" | "requested" | "none";

export type SideRoomActions = {
  enter: boolean;
  join: boolean;
  request_join: boolean;
  knock: boolean;
  invite: boolean;
  suggest_knock?: boolean;
};

export type SideRoom = {
  id: number;
  name: string | null;
  porosity: RoomPorosity;
  porosity_label: RoomPorosityLabel;
  member_count: number;
  present_count: number;
  viewer_state: SideRoomViewerState;
  viewer_invitation?: RoomMemberInvitation | null;
  actions: SideRoomActions;
};

export type SideRoomsResponse = {
  parent: RoomReference | null;
  adjacent_rooms: SideRoom[];
  can_create: boolean;
};

export type CreateSideRoomPayload = {
  name?: string;
  user_ids?: Array<string | number>;
};

export type CreateSideRoomResponse = {
  room: RoomPayload;
  invitations: Array<{
    id: number;
    user_id: number;
    status: MemberInvitationStatus;
  }>;
};

export type JoinRoomResponse = {
  state: "member" | "requested";
};

export type SuggestRoomKnockResponse = {
  state: "suggested";
};

export type RoomPerson = {
  id: number;
  display_username: string;
  avatar_url: string | null;
};

export type JoinRequestStatus = "pending" | "approved" | "declined";

export type RoomJoinRequest = {
  id: number;
  user: RoomPerson;
  status: JoinRequestStatus;
  created_at: string;
  reviewed_at: string | null;
};

export type RoomJoinRequestsResponse = {
  join_requests: RoomJoinRequest[];
};

export type MemberInvitationStatus = "pending" | "accepted" | "declined" | "revoked";

export type RoomMemberInvitation = {
  id: number;
  room_id: number;
  user: RoomPerson;
  invited_by: Pick<RoomPerson, "id" | "display_username">;
  status: MemberInvitationStatus;
  created_at: string;
  responded_at: string | null;
};

export type RoomMemberInvitationsResponse = {
  invitations: RoomMemberInvitation[];
};

export type RoomMemberInvitationResponse = {
  invitation: RoomMemberInvitation;
};

export type KnockStatus = "pending" | "admitted" | "declined" | "revoked";

export type RoomKnock = {
  id: number;
  user: RoomPerson;
  status: KnockStatus;
  created_at: string;
  reviewed_at: string | null;
};

export type RoomKnocksResponse = {
  knocks: RoomKnock[];
};

export type RoomKnockResponse = {
  knock: RoomKnock;
};

export type RequestKnockResponse = {
  state: "requested" | "admitted";
};

export type RoomNotificationDelivery = {
  id: number;
  notification_event_id: number;
  user_id: number;
  user_name: string;
  state: string;
  created_at: string;
  due_at: string | null;
  sent_at: string | null;
  cancelled_at: string | null;
  skip_reason: string | null;
  last_error: string | null;
  event_type: string;
  entry_id: number | null;
  reply_id: string | null;
  link_path: string | null;
  link_label: string;
  content_seen: boolean;
};

export type RoomNotificationDeliveriesResponse = {
  items: RoomNotificationDelivery[];
};

export type DeleteRoomMemberResponse = {
  success: true;
  member_id: number;
};

export type DeleteRoomResponse = {
  success: true;
  room_id: number;
};

export type RoomFirstEntryPromptMember = {
  id: number;
  user_id: number;
  display_username: string;
  display_avatar_url?: string | null;
  avatar_url?: string | null;
  first_entry_prompt_override: string | null;
  effective_first_entry_prompt: string;
};

export type RoomFirstEntryPromptsResponse = {
  default_prompt: string;
  room_prompt: string | null;
  effective_room_prompt: string;
  members: RoomFirstEntryPromptMember[];
};

export type UpdateRoomFirstEntryPromptsPayload = {
  room_prompt?: string | null;
  member_prompts?: Array<{
    membership_id: number;
    prompt: string | null;
  }>;
};

export async function fetchRoom(client: ApiClient, roomId: string | number): Promise<RoomPayload> {
  return normalizeRoom(await client.get<RoomPayload>(`/v2/rooms/${roomId}`));
}

export async function fetchRoomMembers(
  client: ApiClient,
  roomId: string | number,
): Promise<RoomMembersResponse> {
  return client.get<RoomMembersResponse>(`/v2/rooms/${roomId}/members`);
}

export async function fetchSideRooms(
  client: ApiClient,
  roomId: string | number,
): Promise<SideRoomsResponse> {
  const response = await client.get<SideRoomsResponse>(`/v2/rooms/${roomId}/adjacent-rooms`);
  return {
    ...response,
    adjacent_rooms: response.adjacent_rooms.map((roomDetails) => ({
      ...roomDetails,
      porosity_label: roomPorosityLabel(roomDetails.porosity),
    })),
  };
}

export async function createSideRoom(
  client: ApiClient,
  roomId: string | number,
  payload: CreateSideRoomPayload,
): Promise<RoomPayload> {
  const response = await client.post<CreateSideRoomResponse>(
    `/v2/rooms/${roomId}/adjacent-rooms`,
    payload,
  );
  return normalizeRoom(response.room);
}

export async function joinRoom(
  client: ApiClient,
  roomId: string | number,
): Promise<JoinRoomResponse> {
  return client.post<JoinRoomResponse>(`/v2/rooms/${roomId}/join`);
}

export async function fetchRoomJoinRequests(
  client: ApiClient,
  roomId: string | number,
): Promise<RoomJoinRequestsResponse> {
  return client.get<RoomJoinRequestsResponse>(`/v2/rooms/${roomId}/join-requests`);
}

export async function updateRoomJoinRequest(
  client: ApiClient,
  roomId: string | number,
  requestId: string | number,
  status: JoinRequestStatus,
): Promise<{ join_request: RoomJoinRequest }> {
  return client.patch<{ join_request: RoomJoinRequest }>(
    `/v2/rooms/${roomId}/join-requests/${requestId}`,
    { status },
  );
}

export async function fetchRoomMemberInvitations(
  client: ApiClient,
  roomId: string | number,
): Promise<RoomMemberInvitationsResponse> {
  return client.get<RoomMemberInvitationsResponse>(`/v2/rooms/${roomId}/member-invitations`);
}

export async function createRoomMemberInvitation(
  client: ApiClient,
  roomId: string | number,
  userId: string | number,
): Promise<RoomMemberInvitationResponse> {
  return client.post<RoomMemberInvitationResponse>(
    `/v2/rooms/${roomId}/member-invitations`,
    { user_id: userId },
  );
}

export async function suggestRoomKnock(
  client: ApiClient,
  roomId: string | number,
  userId: string | number,
): Promise<SuggestRoomKnockResponse> {
  return client.post<SuggestRoomKnockResponse>(
    `/v2/rooms/${roomId}/knock-suggestions`,
    { user_id: userId },
  );
}

export async function acceptRoomMemberInvitation(
  client: ApiClient,
  roomId: string | number,
  invitationId: string | number,
): Promise<RoomMemberInvitationResponse> {
  return client.post<RoomMemberInvitationResponse>(
    `/v2/rooms/${roomId}/member-invitations/${invitationId}/accept`,
  );
}

export async function updateRoomMemberInvitation(
  client: ApiClient,
  roomId: string | number,
  invitationId: string | number,
  status: MemberInvitationStatus,
): Promise<RoomMemberInvitationResponse> {
  return client.patch<RoomMemberInvitationResponse>(
    `/v2/rooms/${roomId}/member-invitations/${invitationId}`,
    { status },
  );
}

export async function fetchRoomKnocks(
  client: ApiClient,
  roomId: string | number,
): Promise<RoomKnocksResponse> {
  return client.get<RoomKnocksResponse>(`/v2/rooms/${roomId}/knocks`);
}

export async function requestRoomKnock(
  client: ApiClient,
  roomId: string | number,
): Promise<RequestKnockResponse> {
  return client.post<RequestKnockResponse>(`/v2/rooms/${roomId}/knocks`);
}

export async function updateRoomKnock(
  client: ApiClient,
  roomId: string | number,
  knockId: string | number,
  status: KnockStatus,
): Promise<RoomKnockResponse> {
  return client.patch<RoomKnockResponse>(
    `/v2/rooms/${roomId}/knocks/${knockId}`,
    { status },
  );
}

export async function fetchRoomNotificationDeliveries(
  client: ApiClient,
  roomId: string | number,
): Promise<RoomNotificationDeliveriesResponse> {
  return client.get<RoomNotificationDeliveriesResponse>(`/v2/rooms/${roomId}/notification-deliveries`);
}

export async function deleteRoomMember(
  client: ApiClient,
  roomId: string | number,
  membershipId: string | number,
): Promise<DeleteRoomMemberResponse> {
  return client.delete<DeleteRoomMemberResponse>(`/v2/rooms/${roomId}/members/${membershipId}`);
}

export async function deleteRoom(
  client: ApiClient,
  roomId: string | number,
): Promise<DeleteRoomResponse> {
  return client.delete<DeleteRoomResponse>(`/v2/rooms/${roomId}`);
}

export async function fetchRoomFirstEntryPrompts(
  client: ApiClient,
  roomId: string | number,
): Promise<RoomFirstEntryPromptsResponse> {
  return normalizeFirstEntryPrompts(
    await client.get<RoomFirstEntryPromptsResponse>(`/v2/rooms/${roomId}/first-entry-prompts`),
  );
}

type RoomForm = {
  name?: string;
  porosity?: RoomPorosity;
  avatar?: File | null;
  remove_avatar?: boolean;
};

export function roomFormData(payload: Omit<RoomForm, "avatar">) {
  const form = new FormData();
  if (payload.name !== undefined) form.append("room[name]", payload.name);
  if (payload.porosity !== undefined) form.append("room[porosity]", payload.porosity);
  if (payload.remove_avatar) {
    form.append("room[remove_avatar]", "true");
  }
  return form;
}

function buildFormData(payload: RoomForm) {
  const form = roomFormData(payload);
  if (payload.avatar) form.append("room[avatar]", payload.avatar);
  return form;
}

export async function updateRoomRecord(client: ApiClient, id: string | number, form: FormData): Promise<RoomPayload> {
  return normalizeRoom(await client.patch<RoomPayload>(`/v2/rooms/${id}`, form));
}

export async function createRoom(client: ApiClient, payload: RoomForm): Promise<RoomPayload> {
  return createRoomRecord(client, buildFormData(payload));
}

/** Platform adapters supply files while sharing the Room creation contract. */
export async function createRoomRecord(client: ApiClient, form: FormData): Promise<RoomPayload> {
  return normalizeRoom(await client.post<RoomPayload>("/v2/rooms", form));
}

export async function updateRoom(
  client: ApiClient,
  roomId: string | number,
  payload: RoomForm,
): Promise<RoomPayload> {
  return updateRoomRecord(client, roomId, buildFormData(payload));
}

export async function updateRoomFirstEntryPrompts(
  client: ApiClient,
  roomId: string | number,
  payload: UpdateRoomFirstEntryPromptsPayload,
): Promise<RoomFirstEntryPromptsResponse> {
  return normalizeFirstEntryPrompts(
    await client.patch<RoomFirstEntryPromptsResponse>(`/v2/rooms/${roomId}/first-entry-prompts`, {
      room_prompt: payload.room_prompt,
      member_prompts: payload.member_prompts,
    }),
  );
}

function normalizeFirstEntryPrompts(payload: RoomFirstEntryPromptsResponse): RoomFirstEntryPromptsResponse {
  return {
    ...payload,
    room_prompt: payload.room_prompt ?? null,
    effective_room_prompt:
      payload.effective_room_prompt ?? payload.default_prompt,
  };
}

function normalizeRoom(payload: RoomPayload): RoomPayload {
  return {
    ...payload,
    replySettings: normalizeRoomReplySettings(payload.replySettings),
    porosity: normalizeRoomPorosity(payload.porosity),
    porosity_label: roomPorosityLabel(payload.porosity),

  };
}

export function roomPorosityLabel(value?: string | null): RoomPorosityLabel {
  if (value === "masked") return "Visit only";
  if (value === "closed") return "Knock only";
  return "Open";
}

export function roomAccess(payload?: RoomPayload | null): RoomAccess {
  return payload?.access ?? {
    kind: "visitor",
    can_manage: false,
    can_create_adjacent_room: false,
    can_view_notes: false,
    can_write_wall: false,
    can_participate_rounds: false,
  };
}

export function normalizeRoomPorosity(value?: string | null): RoomPorosity {
  if (value === "masked" || value === "closed") return value;
  return "open";
}

/** Accessible ancestry ends at the first denied parent and guards cycles. */
export async function fetchRoomAncestry(client: ApiClient, roomDetails: RoomPayload) {
  const ancestors: RoomReference[] = [];
  const visited = new Set([String(roomDetails.id)]);
  let parent = roomDetails.parent;
  while (parent && !visited.has(String(parent.id))) {
    visited.add(String(parent.id)); ancestors.unshift(parent);
    try { parent = (await fetchRoom(client, parent.id)).parent; } catch { break; }
  }
  return ancestors;
}

export async function updateRoomFeedbackSettings(client: Pick<ApiClient, "patch">, roomId: string | number, settings: RoomReplySettings): Promise<RoomReplySettings> {
  return normalizeRoomReplySettings(await client.patch<RoomReplySettings>(`/v1/rooms/${roomId}/feedback-settings`, settings));
}
