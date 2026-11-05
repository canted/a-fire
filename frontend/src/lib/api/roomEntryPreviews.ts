import type { RoomEntryContext } from "../../contracts/sharedEntry";
import type { TiptapDoc } from "../tiptap";
import type { EntrySubjectPayload } from "../../contracts/entrySubjects";
import type { EntryProvenance, ReflectionSummary } from "../../contracts/entries";
import type { EntryFormat, EntryFormatData } from "../../contracts/entryFormats";
export interface EntryPreview extends RoomEntryContext {
  id: string;
  content: TiptapDoc;
  subject?: EntrySubjectPayload | null;
  format?: EntryFormat;
  formatData?: EntryFormatData | null;
  createdAt?: string;
  reflections?: ReflectionSummary[];
  replyCount?: number;
  savedResponses?: Array<{ id: string; entryId: string; author: string; text: string; savedAt: string; sourceTitle: string }>;
  replyParticipants?: Array<{ id: number; username: string; avatar_url?: string | null }>;
  locked?: boolean;
  provenance?: EntryProvenance | null;
}

export interface RoomMemberPreview {
  id: string;
  username: string;
  avatarUrl?: string | null;
  latestEntry?: EntryPreview | null;
  recentEntries?: EntryPreview[];
}
