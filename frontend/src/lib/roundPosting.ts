import type { RoundSummary } from "./api/rounds";
export function primaryPostActivityId(activity?: RoundSummary | null) {
  if (!canPostToActivity(activity) || activity.viewerState?.submittedEntryId) return undefined;
  return activity.id;
}
export function canPostToActivity(activity?: RoundSummary | null): activity is RoundSummary {
  const viewerState = activity?.viewerState;
  return Boolean(activity?.status === 'active' && viewerState?.role === 'participant' && viewerState.status === 'active' && viewerState.canSubmit);
}
