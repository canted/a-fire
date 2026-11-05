import { NotFoundException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import type { PrismaService } from "../../../prisma/prisma.service"
import { withActiveRoomTransaction } from "../rooms/room-membership-transaction"

/** Lock order is Room then Note, including when its document has not been created. */
export async function withNoteDocumentTransaction<T>(
  prisma: PrismaService,
  pageId: number,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const hint = await prisma.page.findUnique({ where: { id: pageId }, select: { room_id: true } })
  if (!hint) throw new NotFoundException("Not Found")
  const run = async (transaction: Prisma.TransactionClient) => {
    const rows = await transaction.$queryRaw<Array<{ room_id: number | null }>>`
      SELECT room_id FROM notes WHERE id = ${pageId} AND deleted_at IS NULL FOR UPDATE
    `
    if (!rows.length || rows[0].room_id !== hint.room_id) throw new NotFoundException("Not Found")
    const result = await operation(transaction)
    // Delivered after commit only, including writes from HTTP and queue workers.
    await transaction.$queryRaw`SELECT pg_notify('afire_note_changes', ${String(pageId)})::text`
    return result
  }
  return hint.room_id
    ? withActiveRoomTransaction(prisma, hint.room_id, run)
    : prisma.$transaction(run)
}
