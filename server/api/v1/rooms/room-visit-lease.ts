import type { Prisma } from "@prisma/client"

export const VISIT_INACTIVITY_MS = 24 * 60 * 60 * 1000
type VisitDatabase = Pick<Prisma.TransactionClient, "roomVisit" | "$executeRaw">

export function activeRoomVisit(db: VisitDatabase, roomId: number, userId: number, now: Date) {
  return db.roomVisit.findFirst({ where: { room_id: roomId, user_id: userId, expires_at: { gt: now } } })
}

/** Caller must establish free-entry eligibility or obtain manager approval first. */
export async function grantRoomVisit(db: VisitDatabase, roomId: number, userId: number, source: "porosity" | "knock", now: Date) {
  const expiresAt = new Date(now.getTime() + VISIT_INACTIVITY_MS)
  await db.$executeRaw`
    INSERT INTO room_visits (room_id, user_id, source, last_activity_at, expires_at, created_at)
    VALUES (${roomId}, ${userId}, ${source}, ${now.toISOString()}::timestamp, ${expiresAt.toISOString()}::timestamp, ${now.toISOString()}::timestamp)
    ON CONFLICT (room_id, user_id) DO UPDATE
    SET source = EXCLUDED.source,
        last_activity_at = EXCLUDED.last_activity_at,
        expires_at = EXCLUDED.expires_at
    WHERE room_visits.last_activity_at <= EXCLUDED.last_activity_at
  `
  return db.roomVisit.findUniqueOrThrow({ where: { room_id_user_id: { room_id: roomId, user_id: userId } } })
}

/** Explicit foreground activity may extend a live lease, never revive an expired approval. */
export async function renewRoomVisit(db: VisitDatabase, roomId: number, userId: number, now: Date) {
  await db.roomVisit.updateMany({
    where: { room_id: roomId, user_id: userId, expires_at: { gt: now }, last_activity_at: { lte: now } },
    data: { last_activity_at: now, expires_at: new Date(now.getTime() + VISIT_INACTIVITY_MS) },
  })
  return activeRoomVisit(db, roomId, userId, now)
}
