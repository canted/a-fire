import { Prisma } from "@prisma/client"

/** Room ownership is explicit; Project provenance never grants Room authority. */
export function roomEntryRoomId(post: { room_id?: number | null }): number | null {
  const roomId = post.room_id
  return roomId != null && Number.isInteger(roomId) && roomId > 0 ? roomId : null
}

export function roomEntryWhereScope(roomId: number): Prisma.EntryWhereInput {
  return { room_id: roomId }
}

/** Fixed p alias; callers separately require publication and current access. */
export function roomEntrySqlScope(roomId: number) {
  return Prisma.sql`p.room_id = ${roomId}`
}
