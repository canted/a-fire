import type { RoomEntryContext } from "./sharedEntry";
import type { TiptapDoc } from "../lib/tiptap";
import type { LinkPreviewAttachment } from "./linkPreviews";
import type { EntrySubjectPayload } from "./entrySubjects";
import type { FeedbackRequest } from "../lib/feedback";
import type { EntryFormat, EntryFormatData } from "./entryFormats";

export interface EntryDraftResponse extends RoomEntryContext {
  id: number;
  status: string;
  revision?: number;
  room_id?: number;
  round_id?: number;
  project_id?: number;
  source_entry_id?: number;
  project?: { id: number; name: string } | null;
  round?: {
    id: number;
    name: string;
    submit_by?: string | null;
    feedback_due_at?: string | null;
  } | null;
  content: TiptapDoc;
  format: EntryFormat;
  format_data?: EntryFormatData | null;
  subject?: EntrySubjectPayload | null;
  feedback_request?: FeedbackRequest;
  feedback_request_customized?: boolean;
  creation_origin?: "chat" | "round_activity_cover" | "round_activity_response" | null;
  link_preview?: LinkPreviewAttachment | null;
  user?: {
    id: number;
    username: string;
    avatar_url: string | null;
  };
}
