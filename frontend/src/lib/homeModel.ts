import { appRoutes } from "./appRoutes";
import type { HomeOverview } from "./api/home";
import type { RoundDetail } from "./api/rounds";
import type { ProjectEntry, ProjectSummary } from "./api/projectEntries";
import { activityWaitingMessage, currentActivityActions } from "./roundActions";

/** Home reads a viewer-specific snapshot; personal activity and contributions are distinct from edits. */
export type HomeSnapshot = Omit<HomeOverview, "recentProjects"> & {
  /** YYYY-MM-DD in the viewer's timezone; contribution dates use that same timezone. */
  recentFeedback?: { replyId: number; entryId: number; roomName: string; preview: string } | null;
  featuredRoundId?: string;
  rounds: Array<{ roomName: string; detail: RoundDetail; currentTask?: { prompt: string; image?: { src: string; alt: string; width?: number; height?: number } } }>;
  /** Accessible circles ordered by the viewer’s latest own contribution or chat activity, most recent first. */
  /** Authoritative unseen total for all accessible circles, not only the displayed three. */
  /** Order by the viewer's latest published entry or kept feedback, excluding drafts/edits. */
  recentEntries?: Array<{ project: ProjectSummary; entry: ProjectEntry }>;
  recentProjects: Array<{ project: ProjectSummary; entry: ProjectEntry | null }>;
  /** Per-local-day additions: published entries and kept feedback; excludes edits. */
  activityNextCursor?: string | null;
  activityEntries?: Array<{ id: number; projectId: number; projectName: string; date: string; kind: "material" | "feedback"; label: string }>;
  contributions: Array<{ date: string; count: number }>;
};

export function homeActivityPriorities(activities: HomeSnapshot["rounds"]) {
  return activities.filter(({ detail }) => detail.round.status === "active" && detail.phase !== "complete")
    .map(item => ({ ...item, actions: currentActivityActions(item.detail), joined: item.detail.viewerState.status === "active" && ["participant", "reviewer"].includes(item.detail.viewerState.role || "") }))
    .sort((a, b) => Number(b.joined && b.actions.length > 0) - Number(a.joined && a.actions.length > 0));
}

/** Calendar days, not stacked totals. A week is a column, Monday is its first cell. */
export function contributionCalendar(today: string, contributions: HomeSnapshot["contributions"], weeks = 8) {
  const end = new Date(`${today}T12:00:00Z`);
  const mondayIndex = (end.getUTCDay() + 6) % 7;
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - mondayIndex - (weeks - 1) * 7);
  const counts = new Map(contributions.map(day => [day.date, day.count]));
  return Array.from({ length: weeks * 7 }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    const date = day.toISOString().slice(0, 10);
    return { date, count: Math.max(0, counts.get(date) || 0), future: date > today };
  });
}

/** Both histogram views share a year-wide scale so a day's tint stays consistent. */
export function activityDarknessScale(today: string, contributions: HomeSnapshot["contributions"]) {
  const days = today ? contributionCalendar(today, contributions, 53) : [];
  const maximum = Math.max(1, ...days.filter(day => !day.future).map(day => day.count));
  return (count: number) => `${25 + 75 * Math.max(0, count) / maximum}%`;
}

/** The compact Home task and its destination are shared across presentations. */
export function homeFeaturedTask(data: Pick<HomeSnapshot, "rounds" | "featuredRoundId" | "recentRooms">) {
  const prioritized = homeActivityPriorities(data.rounds);
  const item = prioritized.find(item => item.detail.round.id === data.featuredRoundId) || prioritized[0];
  if (!item) return undefined;
  const avatar = data.recentRooms.find(roomDetails => roomDetails.name === item.roomName)?.avatarUrl;
  const canJoin = !item.joined && item.detail.viewerState.canJoin;
  return {
    key: `activity-${item.detail.round.id}`, canJoin, title: item.detail.round.name,
    name: item.roomName, avatar,
    text: item.joined && !item.actions.length ? activityWaitingMessage(item.detail) : item.currentTask?.prompt || item.detail.round.prompt || item.detail.round.name,
    image: item.currentTask?.image || (canJoin && avatar ? { src: avatar, alt: '' } : undefined),
    isRoomImage: !item.currentTask?.image && canJoin && Boolean(avatar),
    href: appRoutes.round(item.detail.round.id),
  };
}
