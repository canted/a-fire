import type { Prisma } from "@prisma/client"

/** Commit-scoped hint only. Each API reauthorizes its own subscribed sockets. */
export async function notifyRoomChanged(transaction: Prisma.TransactionClient, roomId: number) {
  if (!Number.isSafeInteger(roomId) || roomId <= 0) throw new Error("Invalid Room change identity")
  await transaction.$queryRaw`SELECT pg_notify('afire_room_changes', ${String(roomId)})::text`
}
