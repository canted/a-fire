import type { SessionTransport } from "./transport";
type ApiClient = Pick<SessionTransport, "get" | "post" | "put" | "patch" | "delete">;

export type InviteType = "room_invite" | "new_room_invite";
export type InviteStatus = "active" | "expired" | "used";

export type InvitePayload = {
  id: number;
  email: string | null;
  recipient_label: string;
  invite_type: InviteType;
  room: { id: number; name: string } | null;
  invited_by: { id: number; username: string };
  status: InviteStatus;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

export type InviteIndexResponse = {
  invites: InvitePayload[];
  permissions: { new_room_invite_allowed: boolean };
};

export type InviteSuggestionPayload = {
  invitee_membership_id: number;
  display_name: string;
  shared_communities: Array<{ id: number; name: string | null }>;
};

export type InviteSuggestionsResponse = {
  suggestions: InviteSuggestionPayload[];
};

export type InviteFilters = {
  roomId?: string;
  status?: InviteStatus;
  search?: string;
};

export type CreateInvitePayload = {
  email?: string;
  invitee_membership_id?: string | number;
  invite_type: InviteType;
  room_id?: string | number | null;
};

export async function fetchInvites(client: ApiClient, filters: InviteFilters): Promise<InviteIndexResponse> {
  const params = new URLSearchParams();

  if (filters.roomId) params.set("room_id", filters.roomId);
  if (filters.status) params.set("status", filters.status);
  if (filters.search) params.set("search", filters.search);

  const query = params.toString();
  const path = query ? `/v1/invites?${query}` : "/v1/invites";

  return client.get<InviteIndexResponse>(path);
}

export async function fetchInviteSuggestions(
  client: ApiClient,
  roomId: string | number,
  query: string,
): Promise<InviteSuggestionsResponse> {
  const params = new URLSearchParams({ room_id: String(roomId), q: query });
  return client.get<InviteSuggestionsResponse>(`/v1/invites/suggestions?${params.toString()}`);
}

export async function createInvite(client: ApiClient, payload: CreateInvitePayload): Promise<InvitePayload> {
  return client.post<InvitePayload>("/v1/invites", { invite: payload });
}

export async function expireInvite(client: ApiClient, inviteId: number): Promise<InvitePayload> {
  return client.post<InvitePayload>(`/v1/invites/${inviteId}/expire`);
}

export async function resendInvite(client: ApiClient, inviteId: number): Promise<InvitePayload> {
  return client.post<InvitePayload>(`/v1/invites/${inviteId}/resend`);
}
