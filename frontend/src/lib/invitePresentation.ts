import type { InviteSuggestionPayload } from './api/invites';
import { parseTimestamp } from './time';

export function inviteSuggestionLabel(suggestion: InviteSuggestionPayload) {
  const rooms = suggestion.shared_communities.map(room => room.name?.trim() || 'Room').filter(Boolean).join(', ');
  return rooms ? `${suggestion.display_name} (${rooms})` : suggestion.display_name;
}
export function inviteDate(value: string) {
  return parseTimestamp(value)?.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) ?? value;
}
