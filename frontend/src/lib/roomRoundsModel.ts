import type { RoomRoundsResponse, RoundSummary } from "./api/rounds";

/** Shared Room scoping and participation ordering. */
export function roomRoundsModel(data: RoomRoundsResponse | undefined, room: string, canParticipate: boolean) {
  if (data?.roomId !== undefined && data.roomId !== room) return { current: [], all: [], contributions: [], history: [] };
  const belongs = (activity: RoundSummary) => String(activity.roomId) === room;
  const current = (data?.currentRounds ?? (data?.activeRound ? [data.activeRound] : [])).filter(belongs);
  const recent = (data?.recentRounds ?? []).filter(belongs);
  const all = [...current, ...recent];
  const contributions = canParticipate && data?.participationPreview !== undefined
    ? (data.roomId === room ? data.participationPreview : [])
    : canParticipate ? all.flatMap(activity => (activity.viewerContributions ?? []).map(contribution => ({ round: activity, contribution })))
    .sort((a, b) => (b.contribution.occurredAt ?? '').localeCompare(a.contribution.occurredAt ?? '')) : [];
  const history = (canParticipate || (data?.viewerAccess?.kind === "visitor" && data.viewerAccess.scope === "all")) ? data?.roomHistory ?? recent.filter(activity => activity.status === 'archived').map(activity => ({ id: activity.id, label: `${activity.name} completed`, occurredAt: activity.closedAt ?? '', roundId: activity.id })) : [];
  return { current, all, contributions, history };
}
