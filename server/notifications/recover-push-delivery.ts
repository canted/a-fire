import type { PrismaClient } from "@prisma/client"
import type { BossService } from "../queue/boss.service"
import { NOTIFICATION_DELAYED_PUSH_QUEUE } from "./notification-delivery.service"

type Queue = Pick<BossService, "hasOutstandingJob" | "enqueueInTransaction">

/** Operator-selected recovery only. Sending remains owned by the authorized worker. */
export async function recoverPushDelivery(database: Pick<PrismaClient, "$transaction">, queue: Queue, deliveryId: number, before: Date, execute = false, options: { workerStopped?: boolean } = {}) {
  if (!Number.isSafeInteger(deliveryId) || deliveryId < 1 || deliveryId > 2147483647 || !Number.isFinite(before.getTime())) throw Error("Explicit delivery and cutoff required")
  return database.$transaction(async tx => {
    if (execute) {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
      await tx.$queryRaw`SELECT id FROM notification_push_deliveries WHERE id=${deliveryId} FOR UPDATE`
    }
    const delivery = await tx.notificationPushDelivery.findUnique({ where: { id: deliveryId } })
    if (!delivery) return { outcome: "not_found" } as const
    const interrupted = delivery.state === "sending"
    if (interrupted && !options.workerStopped) return {outcome:"worker_stop_confirmation_required"} as const
    if (!interrupted && !["failed", "partial", "uncertain"].includes(delivery.state)) return { outcome: "not_failed" } as const
    if (delivery.updated_at > before) return { outcome: "newer_than_cutoff" } as const
    const groups = await tx.notificationPushDeviceAttempt.groupBy({by:["state"],where:{delivery_id:deliveryId},_count:{_all:true}})
    const counts = Object.fromEntries(groups.map(group=>[group.state,group._count._all]))
    // Historical failed deliveries have no journal; preserve their explicit uncertain recovery path.
    if (interrupted && !groups.length) return {outcome:"interrupted_without_journal"} as const
    if (!interrupted && (groups.length || delivery.state !== "failed") && !counts.rejected) return {outcome:"no_retryable_devices"} as const
    const evidence = {
      uncertain_external_outcome: !groups.length || Boolean(counts.started || counts.uncertain),
      ...(groups.length ? {device_outcomes:counts} : {}),
      ...(interrupted ? {unfinished_attempts_held:counts.started ?? 0} : {}),
    }
    if (await queue.hasOutstandingJob(tx, NOTIFICATION_DELAYED_PUSH_QUEUE, { deliveryId })) return { outcome: "outstanding_job" } as const
    if (!execute) return { outcome: "eligible", ...evidence } as const
    const now = new Date()
    if (interrupted) await tx.$executeRaw`UPDATE notification_push_device_attempts
      SET state='uncertain',completed_at=GREATEST(clock_timestamp() AT TIME ZONE 'UTC',started_at),
        last_error=COALESCE(last_error,'Worker interrupted; external outcome unknown')
      WHERE delivery_id=${deliveryId} AND state='started'`
    const jobId = await queue.enqueueInTransaction(tx, NOTIFICATION_DELAYED_PUSH_QUEUE, { deliveryId })
    await tx.notificationPushDelivery.update({ where: { id: deliveryId }, data: {
      state: "scheduled", due_at: now, scheduled_job_id: jobId, updated_at: now,
      // Preserve prior diagnostics until the worker records its new outcome.
    } })
    return { outcome: "enqueued", ...evidence } as const
  })
}
