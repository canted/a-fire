import { normalizeMentionTargetType } from "../../../../types/mention-target"
import { isDeepStrictEqual } from "node:util"
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import type { RoomAccessService } from "../rooms/room-access.service"
import { hasLimitedRoomHistory } from "../rooms/room-door-policy"
import { canReadRoundStatus } from "../rounds/round-visibility"
import { roundRoomId } from "../rounds/round-scope"

function mentionAttributes(content: unknown): Array<Record<string, unknown>> {
  const references: Array<Record<string, unknown>> = []
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return
    if (Array.isArray(value)) { value.forEach(visit); return }
    const node = value as Record<string, unknown>
    if (node.type === "mention") {
      if (!node.attrs || typeof node.attrs !== "object" || Array.isArray(node.attrs)) throw new BadRequestException("Invalid mention")
      references.push(node.attrs as Record<string, unknown>)
    }
    visit(node.content)
  }
  visit(content)
  return references
}

function referenceIdentity(attrs: Record<string, unknown>, roomId: number | null) {
  const type = normalizeMentionTargetType(attrs.targetType), id = Number(attrs.targetId)
  if (!/^[1-9]\d*$/.test(String(attrs.targetId)) || !Number.isSafeInteger(id) || id > 2147483647) throw new BadRequestException("Invalid mention")
  if (!type) throw new BadRequestException("Invalid mention type")
  const userRoom = type === "user" ? roomId ?? Number(String(attrs.href ?? "").match(/^\/app\/(?:rooms|circles)\/([1-9]\d*)\/members\/[1-9]\d*$/)?.[1]) : null
  if (type === "user" && (!Number.isSafeInteger(userRoom) || userRoom! <= 0 || userRoom! > 2147483647)) throw new ForbiddenException("Mention unavailable")
  return { type, id, userRoom, key: `${type}:${id}`, cacheKey: `${type}:${id}:${userRoom ?? ""}` }
}
type Reference = ReturnType<typeof referenceIdentity>

async function referenceScope(database: Prisma.TransactionClient, reference: Reference) {
  const { type, id, userRoom } = reference
  let roomId: number | null = null, status: string | undefined
  if (type === "user") roomId = userRoom
  else if (type === "room") roomId = id
  else if (type === "note") {
    const page = await database.page.findFirst({ where: { id, deleted_at: null }, select: { room_id: true } })
    roomId = page?.room_id ?? null
  } else {
    const round = await database.round.findUnique({ where: { id }, select: { room_id: true, status: true } })
    if (round) { roomId = roundRoomId(round); status = round.status }
  }
  if (!roomId) throw new ForbiddenException("Mention unavailable")
  return { roomId, status }
}

/** Call before destination/resource locks, supplying every document in the write.
 * Scope is discovered before ordered Room locks, then rechecked under target locks.
 * The caller still runs authorizeMentionReferences to enforce target capabilities.
 * Retention exemptions require a trusted stored Document rechecked under its lock.
 */
export async function lockMentionReferenceAccess(
  database: Prisma.TransactionClient, access: Pick<RoomAccessService, "requireAccessesInTransaction">,
  contents: readonly unknown[], userId: number, roomId: number | null,
  memberRoomIds: readonly number[] = [], retainedContent?: unknown,
) {
  const references = new Map<string, Reference>()
  const retained = mentionAttributes(retainedContent)
  for (const content of contents) for (const attrs of mentionAttributes(content)) {
    if (retained.some(previous => isDeepStrictEqual(previous, attrs))) continue
    const reference = referenceIdentity(attrs, roomId)
    references.set(reference.cacheKey, reference)
  }
  const scopes = new Map<string, Awaited<ReturnType<typeof referenceScope>>>()
  const roomIds = new Set<number>(roomId === null ? [] : [roomId])
  for (const [key, reference] of references) {
    const scope = await referenceScope(database, reference)
    scopes.set(key, scope); roomIds.add(scope.roomId)
  }
  if (roomIds.size) await access.requireAccessesInTransaction(database, [...roomIds], userId, memberRoomIds)
  const ordered = [...references.values()].sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id || (a.userRoom ?? 0) - (b.userRoom ?? 0))
  for (const reference of ordered) {
    const { type, id, userRoom } = reference
    if (type === "round") await database.$queryRaw`SELECT id FROM rounds WHERE id = ${id} FOR SHARE`
    if (type === "note") await database.$queryRaw`SELECT id FROM notes WHERE id = ${id} FOR SHARE`
    if (type === "user") await database.$queryRaw`SELECT id FROM room_memberships WHERE room_id = ${userRoom} AND user_id = ${id} FOR SHARE`
    const current = await referenceScope(database, reference), prepared = scopes.get(reference.cacheKey)!
    if (current.roomId !== prepared.roomId) throw new ConflictException("Mention scope changed. Try again.")
  }
}

/** Validate typed references against the sender's current access, not suggestion caches.
 * Call inside the content write transaction. No source content is copied into labels.
 */
export async function authorizeMentionReferences(
  database: Prisma.TransactionClient, access: Pick<RoomAccessService, "resolve">,
  content: Prisma.InputJsonValue, userId: number, roomId: number | null, retainedContent?: unknown,
): Promise<Prisma.InputJsonValue> {
  const result = structuredClone(content)
  // Only persisted content supplied by a trusted caller can retain inaccessible references.
  const retained = mentionAttributes(retainedContent)
  const destinations = new Map<string, string>()
  for (const attrs of mentionAttributes(result)) {
    if (retained.some(previous => isDeepStrictEqual(previous, attrs))) continue
    const reference = referenceIdentity(attrs, roomId), { type, id, key, cacheKey } = reference
    let href = destinations.get(cacheKey)
    if (!href) {
      const scope = await referenceScope(database, reference)
      if (type === "user") {
        if (roomId === null && !await access.resolve(scope.roomId, userId, new Date(), database)) throw new ForbiddenException("Mention unavailable")
        const member = await database.roomMembership.findFirst({ where: { room_id: scope.roomId, user_id: id, disabled: false }, select: { id: true } })
        if (!member) throw new ForbiddenException("Mention unavailable")
        href = `/app/rooms/${scope.roomId}/members/${id}`
      } else {
        const targetAccess = await access.resolve(scope.roomId, userId, new Date(), database)
        if (!targetAccess || type === "note" && !targetAccess.canViewNotes || type === "round" && !canReadRoundStatus(scope.status!, targetAccess.kind, hasLimitedRoomHistory(targetAccess))) throw new ForbiddenException("Mention unavailable")
        href = type === "room" ? `/app/rooms/${id}` : type === "note" ? `/app/note/${id}` : `/app/rounds/${id}`
      }
      destinations.set(cacheKey, href)
    }
    attrs.id = key
    attrs.href = href
    // A caller-provided identity image must not turn a mention into a media reference.
    attrs.avatarUrl = null
  }
  return result
}
