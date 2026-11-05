import type { SessionTransport } from "./transport";
type ApiClient = Pick<SessionTransport, "get" | "post" | "patch" | "delete" | "put">;

export type Identity = {
  id: number;
  username: string;
  profile_line?: string | null;
  avatar_url?: string | null;
};

export type Membership = {
  id: number;
  room: { id: number; name: string | null; avatar_url?: string | null };
  username?: string | null;
  username_override?: string | null;
  profile_line_override?: string | null;
  disabled: boolean;
  display_username: string;
  display_profile_line?: string | null;
  display_avatar_url?: string | null;
  avatar_url?: string | null;
  notify: boolean;
};

export type MembershipIndexResponse = {
  user: Identity;
  memberships: Membership[];
};

export async function fetchMemberships(client: ApiClient): Promise<MembershipIndexResponse> {
  return client.get<MembershipIndexResponse>("/v1/memberships");
}

export type IdentityFields = { username?: string; profile_line?: string | null; remove_avatar?: boolean };
export type MembershipFields = { username_override?: string | null; profile_line_override?: string | null; notify?: boolean; remove_avatar?: boolean };

export function identityFormData(payload: IdentityFields) {
  const form = new FormData();
  if (payload.username !== undefined) form.append("profile[username]", payload.username);
  if (payload.profile_line !== undefined) form.append("profile[profile_line]", payload.profile_line ?? "");
  if (payload.remove_avatar) form.append("profile[remove_avatar]", "true");
  return form;
}
export function membershipFormData(payload: MembershipFields) {
  const form = new FormData();
  if (payload.username_override !== undefined) form.append("membership[username_override]", payload.username_override || "");
  if (payload.profile_line_override !== undefined) form.append("membership[profile_line_override]", payload.profile_line_override || "");
  if (payload.notify !== undefined) form.append("membership[notify]", payload.notify ? "true" : "false");
  if (payload.remove_avatar) form.append("membership[remove_avatar]", "true");
  return form;
}
export function updateIdentityRecord(client: ApiClient, form: FormData): Promise<Identity> {
  return client.patch<Identity>("/v2/profile/avatar", form);
}
export function updateMembershipRecord(client: ApiClient, membershipId: number, form: FormData): Promise<Membership> {
  return client.patch<Membership>(`/v1/memberships/${membershipId}`, form);
}
export async function updateDefaultIdentity(client: ApiClient, payload: IdentityFields & { avatar?: File | null }): Promise<Identity> {
  const form = identityFormData(payload);
  if (payload.avatar) form.append("profile[avatar]", payload.avatar);
  return updateIdentityRecord(client, form);
}
export async function updateMembership(client: ApiClient, membershipId: number, payload: MembershipFields & { avatar?: File | null }): Promise<Membership> {
  const form = membershipFormData(payload);
  if (payload.avatar) form.append("membership[avatar]", payload.avatar);
  return updateMembershipRecord(client, membershipId, form);
}

export async function disableMembership(client: ApiClient, membershipId: number): Promise<Membership> {
  return client.post<Membership>(`/v1/memberships/${membershipId}/disable`);
}

export async function enableMembership(client: ApiClient, membershipId: number): Promise<Membership> {
  return client.post<Membership>(`/v1/memberships/${membershipId}/enable`);
}
