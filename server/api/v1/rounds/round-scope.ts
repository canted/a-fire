import { ForbiddenException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

/** Round authority is always its explicit Room, never an inherited container. */
export function activityScope(room: { id?: number | null; room_id: number | null }): Prisma.RoundWhereInput {
  if (!room.room_id) throw new ForbiddenException("Round has no Room")
  return roomRoundScope(room.room_id)
}

export function roomRoundScope(roomId: number): Prisma.RoundWhereInput {
  return { room_id: roomId }
}

export function roundRoomId(round: { room_id?: number | null }) {
  return round.room_id ?? null
}

/** Fixed r alias used by authorized Room projections. */
export function roomRoundSqlScope(roomId: number) {
  return Prisma.sql`r.room_id = ${roomId}`
}
