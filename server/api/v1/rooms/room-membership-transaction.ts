import { ForbiddenException, NotFoundException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import type { PrismaService } from "../../../prisma/prisma.service"

/** One Room-row lock orders membership transitions against Room deletion. */
export async function withActiveRoomTransaction<T>(
  database: PrismaService,
  roomId: number,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return database.$transaction(async transaction => {
    await lockActiveRoom(transaction, roomId)
    return operation(transaction)
  })
}

/** Unresolved historical conflicts must not be bypassed by ordinary admission. */
export async function withRoomMembershipTransaction<T>(
  database: PrismaService,
  roomId: number,
  userId: number,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return withActiveRoomTransaction(database, roomId, async transaction => {
    await assertMembershipReconciled(transaction, roomId, userId)
    return operation(transaction)
  })
}

export async function assertMembershipReconciled(transaction: Prisma.TransactionClient, roomId: number, userId: number) {
  const pending = await transaction.roomMembershipReconciliation.findUnique({
    where: { room_id_user_id: { room_id: roomId, user_id: userId } },
    select: { review_status: true },
  })
  if (pending?.review_status === "pending") throw new ForbiddenException("Room membership requires reconciliation")
}

/** Reuse the Room lock inside a caller-owned transaction; acquire it before other resource locks. */
export async function lockActiveRoom(transaction: Prisma.TransactionClient, roomId: number) {
  const rooms = await transaction.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM rooms WHERE id = ${roomId} AND deleted_at IS NULL FOR UPDATE
  `
  if (!rooms.length) throw new NotFoundException("Community not found")
}
