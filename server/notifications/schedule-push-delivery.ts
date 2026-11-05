import type { PrismaClient } from "@prisma/client"
import type { BossService } from "../queue/boss.service"
import { NOTIFICATION_DELAYED_PUSH_QUEUE } from "./notification-delivery.service"

/** Queue insertion and its recorded identity commit together under the delivery lock. */
export async function schedulePushDelivery(database: Pick<PrismaClient, "$transaction">, queue: Pick<BossService, "hasOutstandingJob" | "enqueueInTransaction">, deliveryId: number) {
  return database.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
    await tx.$queryRaw`SELECT id FROM notification_push_deliveries WHERE id=${deliveryId} FOR UPDATE`
    const delivery = await tx.notificationPushDelivery.findUnique({ where: { id: deliveryId } })
    if (!delivery || delivery.state !== "scheduled" || delivery.scheduled_job_id) return false
    if (await queue.hasOutstandingJob(tx, NOTIFICATION_DELAYED_PUSH_QUEUE, { deliveryId })) return false
    const jobId = await queue.enqueueInTransaction(tx, NOTIFICATION_DELAYED_PUSH_QUEUE, { deliveryId }, { startAfter: delivery.due_at })
    await tx.notificationPushDelivery.update({ where: { id: deliveryId }, data: { scheduled_job_id: jobId, updated_at: new Date() } })
    return true
  })
}
