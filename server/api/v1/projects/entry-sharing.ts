import type { Prisma } from "@prisma/client"
import { findAvailableChatAttachment } from "../../v2/rooms/chat-visibility"
import { snapshotReferences } from "../uploads/uploads.service"
import { isProjectEntry, canReadProjectEntry } from "./project-access"
import { createHash } from "node:crypto"
import { BadRequestException, ForbiddenException } from "@nestjs/common"
import type { SharedFeedbackSnapshot as PublicSharedFeedbackSnapshot } from "../../../../frontend/src/contracts/sharedEntry"

/** Private provenance stays outside the public snapshot representation. */
export type SharedFeedbackSnapshot = PublicSharedFeedbackSnapshot & { original_room_ids: number[] }

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object" && !(value instanceof Date)) return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  return value
}
export function sharingRevision(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
}
export function shareRequestKey(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(value)) throw new BadRequestException("A valid share request key is required")
  return value
}
export function feedbackOrigins(value: unknown): number[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new ForbiddenException("Saved feedback provenance is unavailable")
  const result = new Set<number>()
  for (const item of value) {
    if (!item || typeof item !== "object" || !Number.isInteger(item.source_room_id) || item.source_room_id <= 0) throw new ForbiddenException("Saved feedback provenance is unavailable")
    result.add(item.source_room_id)
    if (item.original_room_ids !== undefined && (!Array.isArray(item.original_room_ids) || item.original_room_ids.some((id: unknown) => !Number.isInteger(id) || Number(id) <= 0))) throw new ForbiddenException("Saved feedback provenance is unavailable")
    for (const id of item.original_room_ids || []) result.add(id)
  }
  return [...result].sort((a, b) => a - b)
}
export function assertFeedbackRoom(value: unknown, roomId: number) {
  if (feedbackOrigins(value).some(id => id !== roomId)) throw new ForbiddenException("Saved feedback can only be shared to its original room")
}

export function entryFeedbackOrigins(post: { source_room_ids?: unknown; shared_feedback?: unknown }): number[] {
  const stored = post.source_room_ids ?? []
  if (!Array.isArray(stored) || stored.some(id => !Number.isInteger(id) || Number(id) <= 0)) throw new ForbiddenException("Saved feedback provenance is unavailable")
  return [...new Set([...stored as number[], ...feedbackOrigins(post.shared_feedback)])].sort((a, b) => a - b)
}

export function assertEntryFeedbackRoom(post: { source_room_ids?: unknown; shared_feedback?: unknown }, roomId: number) {
  if (entryFeedbackOrigins(post).some(id => id !== roomId)) throw new ForbiddenException("Saved feedback can only be shared to its original room")
}

/** Preserve known provenance when authorized media is wrapped in another private entry. */
export async function referencedFeedbackOrigins(prisma: import("../../../prisma/prisma.service").PrismaService, targetPostId: number, userId: number, value: unknown): Promise<number[]> {
  const references = snapshotReferences(value)
  const sources = new Set<number>()
  for (const [type, ids] of [["audio", references.audio], ["video", references.video]] as const) {
    if (!ids.size) continue
    const assets = type === "audio"
      ? await prisma.audioAsset.findMany({ where: { id: { in: [...ids] } }, select: { source_type: true, source_id: true } })
      : await prisma.videoAsset.findMany({ where: { id: { in: [...ids] } }, select: { source_type: true, source_id: true } })
    for (const asset of assets) if (asset.source_type === "Post" && asset.source_id !== targetPostId) sources.add(asset.source_id)
  }
  if (references.blobs.size) {
    const attachments = await prisma.activeStorageAttachment.findMany({ where: { blob_id: { in: [...references.blobs] }, record_type: "Post" }, select: { blob_id: true, record_id: true } })
    // Existing target ownership cannot acquire restrictions from an unrelated later copy.
    const ownBlobs = new Set(attachments.filter(item => item.record_id === targetPostId).map(item => item.blob_id))
    for (const attachment of attachments) if (!ownBlobs.has(attachment.blob_id)) sources.add(attachment.record_id)
  }
  if (!sources.size) return []
  const posts = await prisma.entry.findMany({ where: { id: { in: [...sources] }, status: { not: "deleted" } } })
  const origins = new Set<number>()
  for (const post of posts) {
    // Only inspect private source records this saver can read; never infer from another person's private copy.
    if (!isProjectEntry(post) || !(await canReadProjectEntry(prisma, post, userId))) continue
    for (const origin of entryFeedbackOrigins(post)) origins.add(origin)
    if (post.creation_origin === "project_feedback" && post.source_room_id) origins.add(post.source_room_id)
  }
  return [...origins].sort((a, b) => a - b)
}

/** A retained feedback copy survives withdrawal, but re-sharing requires its original source. */
export async function feedbackSourceAvailable(database: Pick<Prisma.TransactionClient, "chatMessage">, saved: { source_shared_entry_id: number | null }, reply: { status: string; entry: { id: number; status: string; room_id: number | null; creation_origin?: string | null } | null } | null, roomId: number | null) {
  if (!(reply?.status === "published" && reply.entry?.status === "published" && reply.entry.room_id === roomId && reply.entry.id === saved.source_shared_entry_id)) return false
  return reply.entry.creation_origin !== "chat_attachment" || Boolean(roomId && await findAvailableChatAttachment(database, reply.entry.id, roomId))
}
