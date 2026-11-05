import type { SessionTransport } from './transport';
export type AcceptInviteResponse = { success: boolean; redirect: string; notice?: string | null; accessToken?: string; refreshToken?: string };
export function acceptInvite(client: Pick<SessionTransport, 'post'>, token: string) {
  return client.post<AcceptInviteResponse>('/v1/auth/invites/accept', { token });
}
export function inviteRecoveryMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('sign in with the email')) return message;
  if (normalized.includes('already been used')) return 'This invite was already used. Sign in with the email that received it to continue.';
  if (normalized.includes('expired')) return 'This invite has expired. Sign in if you already joined, or ask for a new invite link.';
  return null;
}
