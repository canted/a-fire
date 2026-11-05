import { plainTextFromTiptap } from "../../../lib/tiptap";
import type { EntryPreview } from "../../../lib/api/roomEntryPreviews";
import type { RoomHome } from "../../../lib/api/roomHome";
import type { WallDetail } from "../../../lib/api/walls";
import { selectWallProcess, type WallProcessEntry, type WallProcessSlot } from "./selectWallProcess";

export type WallMemberModel = {
  id: string;
  name: string;
  avatarUrl?: string | null;
} & ({ available: true; slots: WallProcessSlot[] } | { available: false });

export function roomProcessEntry(entry: EntryPreview): WallProcessEntry {
  const date = entry.createdAt ?? "";
  return {
    id: entry.id, project: "", date,
    dateLabel: date ? new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "",
    replyCount: entry.replyCount ?? 0, replyParticipants: entry.replyParticipants ?? [],
    statement: entry.room_statement || undefined,
    savedResponses: [...(entry.shared_feedback?.map((feedback, index) => ({
      id: String(feedback.source_reply_id ?? index), entryId: entry.id, author: feedback.author_name,
      text: plainTextFromTiptap(feedback.content) || "Shared media feedback", savedAt: date, sourceTitle: "Shared feedback",
    })) ?? []), ...(entry.savedResponses ?? [])],
    entry: { content: entry.content, format: entry.format ?? "mixed_media", format_data: entry.formatData ?? null },
  };
}

/** Live selection may allocate recent entry, statement and feedback context slots. */
export function roomWallMembers(members: RoomHome["members"]): WallMemberModel[] {
  return members.map(member => ({ id: member.membershipId, name: member.username,
    avatarUrl: member.avatarUrl, available: true,
    slots: selectWallProcess((member.recentEntries ?? (member.latestEntry ? [member.latestEntry] : [])).map(roomProcessEntry)),
  }));
}
/** A result's selection and order are authoritative: never reselect by recency. */
export function roundResultMembers(result: WallDetail): WallMemberModel[] {
  return result.entries.map(item => {
    const identity = { id: item.id, name: item.authorName, avatarUrl: item.authorAvatarUrl };
    if (!item.available || !item.entryId || !item.content) return { ...identity, available: false };
    const entry: WallProcessEntry = { id: item.entryId, project: "", date: result.publishedAt, dateLabel: "",
      replyCount: item.responseCount, replyParticipants: item.responseParticipants,
      entry: { content: item.content, format: item.format, format_data: item.formatData,
        room_statement: item.room_statement, shared_feedback: item.shared_feedback },
    };
    return { ...identity, available: true, slots: [{ kind: "entry", entry }] };
  });
}
