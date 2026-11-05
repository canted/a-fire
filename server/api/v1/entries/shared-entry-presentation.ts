import type { RoomEntryContext, SharedFeedbackSnapshot } from "../../../../frontend/src/contracts/sharedEntry"
import { postFormatDataVariantUrls } from "../uploads/upload-urls"
import { parseEntryFormat, parseEntryFormatData } from "./entry-formats"

/** Public allowlist; never return saved-record IDs, request keys, or private lineage. */
export function sharedEntryPresentation(post: { room_statement?: string | null; shared_feedback?: unknown }): RoomEntryContext {
  const shared_feedback = Array.isArray(post.shared_feedback) ? post.shared_feedback.flatMap((value): SharedFeedbackSnapshot[] => {
    if (!value || typeof value !== "object" || typeof value.source_room_id !== "number" || !value.content || value.content.type !== "doc") return []
    return [{
      source_reply_id: typeof value.source_reply_id === "number" ? value.source_reply_id : null,
      source_shared_entry_id: typeof value.source_shared_entry_id === "number" ? value.source_shared_entry_id : typeof value.source_post_id === "number" ? value.source_post_id : null,
      source_room_id: value.source_room_id,
      source_author_id: typeof value.source_author_id === "number" ? value.source_author_id : null,
      author_name: typeof value.author_name === "string" ? value.author_name : "Former member",
      content: value.content,
      format: "mixed_media",
      format_data: postFormatDataVariantUrls(parseEntryFormatData(value.format_data), "w1200"),
    }]
  }) : []
  return { room_statement: post.room_statement ?? null, shared_feedback }
}

/** Reuses the authorized, image-hydrated body; never looks up private lineage. */
export function entryContentPresentation(post: { format: string; format_data: unknown; room_statement?: string | null; shared_feedback?: unknown }, content: unknown) {
  return {
    content,
    format: parseEntryFormat(post.format),
    ...sharedEntryPresentation(post),
    format_data: postFormatDataVariantUrls(parseEntryFormatData(post.format_data), "w1200"),
  }
}
