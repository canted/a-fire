import { BadRequestException, ForbiddenException } from "@nestjs/common"
import type { PrismaService } from "../../../prisma/prisma.service"
import { materialDocument } from "../../../../frontend/src/lib/materialDocument"
import type { TiptapDoc, TiptapNode } from "../../../../frontend/src/lib/tiptap"
import { assertEntryFeedbackRoom } from "../projects/entry-sharing"
import { parseEntryFormat, parseEntryFormatData } from "./entry-formats"

type RoomEntry = {
  user_id: number
  source_entry_id?: number | null
  room_id?: number | null
  shared_feedback?: unknown
  source_room_ids?: unknown
}

/** Enforce only on new publication/intake; historical published copies stay readable. */
export async function assertRoomEntrySource(prisma: Pick<PrismaService, "entry">, post: RoomEntry) {
  if (!post.source_entry_id) throw new BadRequestException("This draft has no private project source. Save the work in your own project, then share that entry to the Room.")
  const source = await prisma.entry.findFirst({
    where: {
      id: post.source_entry_id, user_id: post.user_id, status: "published", creation_origin: "project_material",
      room_id: null, project: { OR: [{ owner_id: post.user_id }, { participations: { some: { user_id: post.user_id, status: "accepted" } } }] },
    },
    select: { id: true },
  })
  if (!source) throw new BadRequestException("The private source entry is unavailable. Save the work in your own project, then share it again.")
}

/** Validate the public selection as one payload without merging its stored snapshots. */
export function roomEntryValidationContent(post: Pick<RoomEntry, "shared_feedback" | "source_room_ids" | "room_id">, content: unknown, roomId = post.room_id) {
  if (roomId) assertEntryFeedbackRoom(post, roomId)
  else if (post.shared_feedback != null || post.source_room_ids != null) {
    throw new ForbiddenException("A Room is required to validate saved feedback provenance")
  }
  if (post.shared_feedback == null) return content
  if (!Array.isArray(post.shared_feedback)) throw new BadRequestException("Shared feedback must be a list of snapshots")
  if (!post.shared_feedback.length) return content
  if (!content || typeof content !== "object" || Array.isArray(content) || (content as TiptapDoc).type !== "doc" || !Array.isArray((content as TiptapDoc).content)) throw new BadRequestException("Entry must be a document")
  const nodes: TiptapNode[] = [...((content as TiptapDoc).content || [])]
  for (const snapshot of post.shared_feedback) {
    if (!snapshot || typeof snapshot !== "object" || !snapshot.content || snapshot.content.type !== "doc" || !Array.isArray(snapshot.content.content)) throw new BadRequestException("Shared feedback must contain a document")
    const format = parseEntryFormat(snapshot.format)
    const format_data = parseEntryFormatData(snapshot.format_data)
    const document = materialDocument({ content: snapshot.content, format, format_data })
    // Mixed-media metadata titles are not repeated in their body document.
    if (format_data?.title && typeof format_data.title === "string") nodes.push({ type: "paragraph", content: [{ type: "text", text: format_data.title }] })
    nodes.push(...(document.content || []))
    // Mixed-media adapters intentionally ignore legacy metadata. Publication must
    // still account for those fields, just as entryContentParts does for the base.
    if (format === "mixed_media" && format_data) {
      if (format_data.image_url) nodes.push({ type: "image", attrs: { src: format_data.image_url } })
      if (format_data.audio_asset_id) nodes.push({ type: "audio", attrs: { audioAssetId: format_data.audio_asset_id } })
      if (format_data.video_asset_id) nodes.push({ type: "video", attrs: { videoAssetId: format_data.video_asset_id } })
      if (typeof format_data.url === "string" && format_data.url) nodes.push({ type: "paragraph", content: [{ type: "text", text: format_data.url, marks: [{ type: "link", attrs: { href: format_data.url } }] }] })
      if (typeof format_data.text === "string" && format_data.text) nodes.push({ type: "paragraph", content: [{ type: "text", text: format_data.text }] })
    }
  }
  return { type: "doc", content: nodes } satisfies TiptapDoc
}
