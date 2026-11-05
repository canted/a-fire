import { ForbiddenException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { assertMembershipReconciled } from "./room-membership-transaction"

type MembershipUser = { id: number }

/** Caller holds the active Room lock. Owns activation rules for every admission path. */
export async function activateRoomMembership(
  transaction: Prisma.TransactionClient, circleId: number, user: MembershipUser, now: Date, managerApproved = false,
) {
  const userId = user.id
  await assertMembershipReconciled(transaction, circleId, userId)
  const existing = await transaction.roomMembership.findFirst({
    where: { room_id: circleId, user_id: userId },
    select: { id: true, revoked_at: true },
  })
  if (existing?.revoked_at && !managerApproved) throw new ForbiddenException("Circle access was removed by its owner")
  if (existing) {
    await transaction.roomMembership.update({
      where: { id: existing.id, ...(managerApproved ? {} : { revoked_at: null }) },
      data: { disabled: false, revoked_at: null, updated_at: now },
    })
  } else {
    await transaction.roomMembership.create({
      data: {
        room_id: circleId,
        user_id: userId,
        disabled: false,
        notify: true,
        created_at: now,
        updated_at: now,
      },
    })
  }
}
