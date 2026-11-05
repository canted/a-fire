import type { TiptapDoc } from "../lib/tiptap";
import type { EntryFormatData } from "./entryFormats";

/** Deliberately shared snapshots only; private save records never enter this contract. */
export type SharedFeedbackSnapshot = {
  source_reply_id: number | null;
  source_shared_entry_id: number | null;
  source_room_id: number;
  source_author_id: number | null;
  author_name: string;
  content: TiptapDoc;
  format: "mixed_media";
  format_data: EntryFormatData | null;
};
export type RoomEntryContext = {
  room_statement?: string | null;
  shared_feedback?: SharedFeedbackSnapshot[];
};
