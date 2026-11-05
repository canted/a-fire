import { roomEntryRoomId } from "../entries/room-entry-scope"
import { notifyRoomChanged } from "../../../realtime/room-change"
import { ForbiddenException } from "@nestjs/common"
import { roundRoomId } from "./round-scope"
import type { Prisma } from "@prisma/client"
import { ART_BEFORE_CHORUS_DESCRIPTION } from "../../../../types/activity-templates"
import type { RoundChatCard } from "./round-chat"

/** Serializes completion and contribution changes. The lock lasts through commit. */
export async function lockRound(tx: Prisma.TransactionClient, activityId: number) {
  await tx.$queryRaw`SELECT id FROM rounds WHERE id = ${activityId} FOR UPDATE`
}

/** Called in the completion transaction, after the final creative phase is published. */
export async function publishRoundWall(tx: Prisma.TransactionClient, activityId: number, backfillLegacy = false) {
  await lockRound(tx, activityId)
  const activity = await tx.round.findUnique({ where: { id: activityId } })
  if (!activity) return null
  const communityId = roundRoomId(activity)
  const existing = await tx.roundResult.findUnique({ where: { round_id: activityId } })
  if (existing) {
    if (existing.room_id !== communityId) throw new ForbiddenException("Wall Room scope conflicts with its Round")
    await announceWall(tx, existing)
    await notifyRoomChanged(tx, existing.room_id)
    return existing
  }
  if (!activity || !communityId || activity.status !== "archived" || !activity.closed_at) return null
  const postIds = activity.template_key === "art_before_chorus"
    ? (await tx.activityArtifact.findMany({ where: { round_id: activityId, kind: "response", status: "active" }, orderBy: [{ user_id: "asc" }, { id: "asc" }] })).map(entry => entry.entry_id)
    : (await tx.activityParticipation.findMany({ where: { round_id: activityId, role: "participant", status: "active", submitted_entry_id: { not: null } }, orderBy: [{ user_id: "asc" }, { id: "asc" }] })).map(entry => entry.submitted_entry_id!)
  if (backfillLegacy && activity.template_key === "feedback" && !postIds.length) {
    // Older rounds can predate participation records. Only retain posts already published at completion.
    const legacyEntries = await tx.entry.findMany({ where: { round_id: activityId, status: "published", project_id: null, created_at: { lte: activity.closed_at }, OR: [{ published_at: null }, { published_at: { lte: activity.closed_at } }] }, orderBy: [{ published_at: "desc" }, { id: "desc" }], select: { id: true, user_id: true } })
    const authors = new Set<number>()
    for (const post of legacyEntries) if (!authors.has(post.user_id)) { authors.add(post.user_id); postIds.push(post.id) }
  }
  const posts = await tx.entry.findMany({ where: { id: { in: postIds }, status: "published", project_id: null, room_id: communityId }, include: { user: true } })
  const memberships = await tx.roomMembership.findMany({ where: { room_id: communityId, user_id: { in: posts.map(post => post.user_id) } }, select: { user_id: true, username_override: true } })
  const names = new Map(memberships.map(member => [member.user_id, member.username_override]))
  const byId = new Map(posts.filter(post => roomEntryRoomId(post) === communityId).map(post => [post.id, post]))
  const wall = await tx.roundResult.create({ data: {
    round_id: activity.id, room_id: communityId, title: activity.name,
    description: activity.template_key === "art_before_chorus" ? activity.prompt || ART_BEFORE_CHORUS_DESCRIPTION : activity.prompt,
    published_at: activity.closed_at,
    entries: { create: [...new Set(postIds)].flatMap((id, position) => {
      const post = byId.get(id)
      return post ? [{ entry_id: id, position, author_name: names.get(post.user_id) || post.user.username }] : []
    }) },
  } })
  await announceWall(tx, wall)
  await notifyRoomChanged(tx, wall.room_id)
  return wall
}

export const wallAnnouncementNonce = (wallId: number) => `wall:${wallId}:published`

export function wallAnnouncementId(message: { entry_origin: string | null; client_nonce: string | null }) {
  if (message.entry_origin !== "wall_publication") return null
  const match = message.client_nonce?.match(/^wall:([1-9]\d*):published$/)
  const id = match ? Number(match[1]) : 0
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export const wallChatInclude = {
  round: { select: { host_id: true, _count: { select: { participations: { where: { role: "participant", status: "active" } } } } } },
  _count: { select: { entries: true } },
} satisfies Prisma.RoundResultInclude

export function wallRoundCard(wall: Prisma.RoundResultGetPayload<{ include: typeof wallChatInclude }>): RoundChatCard {
  return {
    id: wall.round_id, wall_id: wall.id,
    name: wall.title, description: wall.description, status: "archived", completed: true,
    submitted_count: wall._count.entries, participant_count: Math.max(wall._count.entries, wall.round._count.participations),
    occurred_at: wall.published_at.toISOString(), event_label: "Wall published",
  }
}

/** The caller holds the round row lock for this entire transaction, including retries/backfill. */
async function announceWall(tx: Prisma.TransactionClient, wall: { id: number; round_id: number; room_id: number; title: string; published_at: Date }) {
  const nonce = wallAnnouncementNonce(wall.id)
  // Check independently of the current host: a later host change must not duplicate the announcement.
  const existing = await tx.chatMessage.findFirst({ where: { room_id: wall.room_id, client_nonce: nonce, entry_origin: "wall_publication" } })
  if (existing?.timeline_kind === "round_event") return existing
  const source = await tx.roundResult.findUniqueOrThrow({ where: { id: wall.id }, include: wallChatInclude })
  const content = { round_event: wallRoundCard(source) }
  if (existing) return tx.chatMessage.update({ where: { id: existing.id }, data: {
    timeline_kind: "round_event", content, created_at: wall.published_at,
  } })
  return tx.chatMessage.create({ data: {
    room_id: wall.room_id, author_id: source.round.host_id, timeline_kind: "round_event",
    entry_origin: "wall_publication", client_nonce: nonce, body: `Wall published: ${wall.title}`,
    content, masked_alias: "", fire_at: new Date("9999-12-31T00:00:00Z"), expires_at: new Date("9999-12-31T00:00:00Z"),
    created_at: wall.published_at, updated_at: wall.published_at,
  } })
}
