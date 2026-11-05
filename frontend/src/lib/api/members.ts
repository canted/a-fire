import type { TiptapDoc } from "../tiptap";
import type { ReflectionSummary } from "../../contracts/entries";
import type { EntrySubjectPayload } from "../../contracts/entrySubjects";
import type { IntroductionOverview } from "./introductions";
import type { ProjectSummary } from "./projects";
import type { EntryFormat, EntryFormatData } from "../../contracts/entryFormats";
import type { SessionTransport } from "./transport";

export type MemberEntryPreview = {
  id: string;
  createdAt?: string | null;
  content: TiptapDoc;
  format?: EntryFormat;
  formatData?: EntryFormatData | null;
  subject?: EntrySubjectPayload | null;
  reflections?: ReflectionSummary[];
  replyCount?: number;
};

export type MemberEntriesPayload = {
  id: string;
  userId?: string | null;
  viewerUserId: string;
  username: string;
  displayUsername: string;
  profileLine?: string | null;
  avatarUrl?: string | null;
  displayAvatarUrl?: string | null;
  isCurrentUser: boolean;
  roomId?: string | null;
  roomName?: string | null;
  introductionOverview: IntroductionOverview | null;
  projects: ProjectSummary[];
  entries: MemberEntryPreview[];
  pagination: {
    page: number;
    perPage: number;
    nextPage: number | null;
    nextCursor?: string | null;
  };
};

export type MemberProfileTarget = { roomId: string; memberUserId: string };
export function fetchMemberProfile(client: Pick<SessionTransport, 'get'>, target: MemberProfileTarget, page: number | string = 1) {
  return client.get<MemberEntriesPayload>(`/v1/rooms/${encodeURIComponent(target.roomId)}/members/${encodeURIComponent(target.memberUserId)}/entries?${typeof page === "string" ? `cursor=${encodeURIComponent(page)}` : `page=${page}`}`);
}

export function nextMemberHistoryPage(page: MemberEntriesPayload): string | number | null {
  return page.pagination.nextCursor !== undefined ? page.pagination.nextCursor : page.pagination.nextPage;
}
