/** Portable subset used by the first Home → Room slice; full activity/project models extend it. */
export type HomeOverview = {
  today: string;
  roomDashboard?: { newResponses: number; activitiesJoined: number; feedbackGiven: number; entriesShared: number };
  recentRooms: Array<{ id: string; name: string; avatarUrl?: string | null; unseenCount: number; activityText?: string }>;
  totalRoomUnseenCount: number;
  recentProjects: Array<{ project: { id: number; name: string } }>;
};

import type { HomeSnapshot } from '../homeModel';
import type { SessionTransport } from './transport';
import { normalizeRound } from "./rounds";
import { currentActivityActions } from '../roundActions';
export async function fetchHome(client: Pick<SessionTransport, 'get'>, timezone: string, includeActivity = false, activityCursor?: string): Promise<HomeSnapshot> {
  const snapshot = await client.get<HomeSnapshot>(`/v1/projects/home?timezone=${encodeURIComponent(timezone)}${includeActivity ? '&activity=true' : ''}${activityCursor ? `&activity_cursor=${encodeURIComponent(activityCursor)}` : ''}`);
  return { ...snapshot, rounds: snapshot.rounds.map(item => {
    const detail = { ...item.detail, round: normalizeRound(item.detail.round)! };
    const action = currentActivityActions(detail)[0];
    const cover = detail.roundState?.viewer.chosenCover;
    return { ...item, detail, currentTask: action ? {
      prompt: cover && !detail.roundState?.viewer.response && detail.roundState?.config.responseFormat === 'audio' ? 'Record audio in response to this image.' : action.description,
      image: cover ? { src: cover.imageUrl, alt: cover.alt } : undefined,
    } : undefined };
  }) };
}
