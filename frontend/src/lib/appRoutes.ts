import { roundPath } from "../../../types/round-links";
const APP_ROOT_PATH = "/app";

type AppRouteParam = string | number;

function splitPathSuffix(value: string): [string, string] {
  const separatorIndex = value.search(/[?#]/);
  if (separatorIndex === -1) {
    return [value, ""];
  }

  return [value.slice(0, separatorIndex), value.slice(separatorIndex)];
}

function withSearch(pathname: string, params: Record<string, AppRouteParam | null | undefined>) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") return;
    searchParams.set(key, String(value));
  });

  const search = searchParams.toString();
  return search ? `${pathname}?${search}` : pathname;
}

export function appPath(path?: string | null) {
  const value = path?.trim();
  if (!value || value === "/") {
    return APP_ROOT_PATH;
  }

  if (value.startsWith("//")) {
    return value;
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    try {
      const parsed = new URL(value);
      if (typeof window !== "undefined" && parsed.origin !== window.location.origin) {
        return value;
      }

      return appPath(`${parsed.pathname}${parsed.search}${parsed.hash}`);
    } catch {
      return value;
    }
  }

  const [pathnamePart, suffix] = splitPathSuffix(value);
  const pathname = pathnamePart.startsWith("/") ? pathnamePart : `/${pathnamePart}`;
  const normalizedPathname = pathname.replace(/^(?:\/app)+(?=\/|$)/, "");

  return `${APP_ROOT_PATH}${normalizedPathname === "/" ? "" : normalizedPathname}${suffix}`;
}

export const appRoutes = {
  home: () => APP_ROOT_PATH,
  homeActivity: () => appPath("activity"),
  profile: () => appPath("profile"),
  projectNew: () => appPath("projects/new"),
  projects: () => appPath("projects"),
  project: (projectId: AppRouteParam) => appPath(`projects/${projectId}`),
  projectEdit: (projectId: AppRouteParam) => appPath(`projects/${projectId}/edit`),
  projectEntry: (projectId: AppRouteParam, entryId: AppRouteParam) => appPath(`projects/${projectId}/entries/${entryId}`),
  projectEntryMedia: (projectId: AppRouteParam, entryId: AppRouteParam, mediaIndex: AppRouteParam) => appPath(`projects/${projectId}/entries/${entryId}/media/${mediaIndex}`),
  projectEntryNew: (projectId: AppRouteParam) => appPath(`projects/${projectId}/entries/new`),
  projectEntryEdit: (projectId: AppRouteParam, entryId: AppRouteParam) => appPath(`projects/${projectId}/entries/${entryId}/edit`),
  notificationPreferences: () => appPath("notification-preferences"),
  notices: () => appPath("notices"),
  newEntry: () => appPath("new-entry"),
  rooms: () => appPath("rooms"),
  allRooms: () => appPath("rooms/all"),
  room: (roomId: AppRouteParam) => appPath(`rooms/${roomId}`),
  userOnboarding: (params?: { roomId?: AppRouteParam }) =>
    withSearch(appPath("user/new"), params ?? {}),
  roomOnboarding: () => appPath("rooms/new"),
  roomSettings: (roomId: AppRouteParam) => appPath(`rooms/${roomId}/settings`),
  roomMembers: (roomId: AppRouteParam) => `${appPath(`rooms/${roomId}`)}#members`,
  roomParticipation: (roomId: AppRouteParam) => appPath(`rooms/${roomId}/participation`),
  roomHistory: (roomId: AppRouteParam) => appPath(`rooms/${roomId}/history`),
  roomRounds: (roomId: AppRouteParam) => appPath(`rooms/${roomId}/rounds`),
  roomChat: (roomId: AppRouteParam) => appPath(`rooms/${roomId}/chat`),
  roomChatThread: (roomId: AppRouteParam, messageId: AppRouteParam) => appPath(`rooms/${roomId}/chat/messages/${messageId}`),
  roomChatThreadAt: (roomId: AppRouteParam, messageId: AppRouteParam, params: { audioAssetId: AppRouteParam; seconds: number }) =>
    `${appPath(`rooms/${roomId}/chat/messages/${messageId}`)}?audio=${encodeURIComponent(String(params.audioAssetId))}&t=${encodeURIComponent(String(params.seconds))}`,
  roomChatAt: (roomId: AppRouteParam, messageId: AppRouteParam) =>
    `${appPath(`rooms/${roomId}/chat`)}#chat-${messageId}`,
  roomChatPrototype: (roomId: AppRouteParam) => appPath(`rooms/${roomId}/chat`),
  roomAdjacentRooms: (roomId: AppRouteParam) => appPath(`rooms/${roomId}/adjacent-rooms`),
  roomFirstEntryPrompt: (roomId: AppRouteParam) => appPath(`rooms/${roomId}/first-entry-prompt`),
  roomProfile: (roomId: AppRouteParam) => appPath(`rooms/${roomId}/profile`),
  roomNotes: (roomId: AppRouteParam) => appPath(`rooms/${roomId}/notes`),
  roomNoteNew: (roomId: AppRouteParam) => appPath(`rooms/${roomId}/notes/new`),
  roomInvites: (roomId: AppRouteParam) => appPath(`rooms/${roomId}/settings#invites`),
  roomRoundNew: (roomId: AppRouteParam, templateKey?: AppRouteParam) => withSearch(appPath(`rooms/${roomId}/rounds/new`), { templateKey }),
  round: (roundId: AppRouteParam) => roundPath(roundId),
  roundEdit: (roundId: AppRouteParam) => `${roundPath(roundId)}/edit`,
  note: (noteId: AppRouteParam) => appPath(`note/${noteId}`),
  page: (pageId: AppRouteParam) => appPath(`note/${pageId}`),
  entry: (entryId: AppRouteParam) => appPath(`entries/${entryId}`),
  entryProject: (entryId: AppRouteParam) => appPath(`entries/${entryId}/project`),
  entryNewReply: (entryId: AppRouteParam, params: { feedbackType?: AppRouteParam } = {}) =>
    withSearch(appPath(`entries/${entryId}/new-reply`), { feedback_type: params.feedbackType }),
  entryNewReplyAt: (
    entryId: AppRouteParam,
    params: { audioAssetId?: AppRouteParam; seconds?: AppRouteParam; feedbackType?: AppRouteParam } = {},
  ) =>
    withSearch(appPath(`entries/${entryId}/new-reply`), {
      audio: params.audioAssetId,
      t: params.seconds,
      feedback_type: params.feedbackType,
    }),
  noteAudioReply: (
    pageId: AppRouteParam,
    params: { audioAssetId?: AppRouteParam; audioNodeId?: AppRouteParam; seconds?: AppRouteParam } = {},
  ) =>
    withSearch(appPath(`note/${pageId}/audio-reply`), {
      audio: params.audioAssetId,
      audioNode: params.audioNodeId,
      t: params.seconds,
    }),
  audioTimestamp: (
    targetPath: string,
    params: { audioAssetId?: AppRouteParam; audioNodeId?: AppRouteParam; seconds?: AppRouteParam } = {},
  ) =>
    withSearch(targetPath, {
      audio: params.audioAssetId,
      audioNode: params.audioNodeId,
      t: params.seconds,
    }),
  roomMember: (roomId: AppRouteParam, userId: AppRouteParam) => appPath(`rooms/${roomId}/members/${userId}`),
  roomMemberIntroductions: (roomId: AppRouteParam, userId: AppRouteParam) => appPath(`rooms/${roomId}/members/${userId}/introductions`),
};

export { APP_ROOT_PATH };
