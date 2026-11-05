import { schedulePushDelivery } from "@server/notifications/schedule-push-delivery"
import { spawnSync } from "node:child_process"
import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"
import { recoverPushDelivery } from "@server/notifications/recover-push-delivery"
import { NOTIFICATION_DELAYED_PUSH_QUEUE } from "@server/notifications/notification-delivery.service"

it("previews failed push recovery and atomically requeues once under retries and races", async () => {
  const prisma = new PrismaService(), boss = new BossService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@push-recovery.test`, username: "Recipient", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Room", owner_id: user.id, created_at: now, updated_at: now } })
  const event = await prisma.notificationEvent.create({ data: { event_type: "post_created", actor_id: user.id, room_id: room.id, created_at: now, updated_at: now } })
  const inbox = await prisma.notificationInboxItem.create({ data: { user_id: user.id, notification_event_id: event.id, created_at: now, updated_at: now } })
  const delivery = await prisma.notificationPushDelivery.create({ data: { user_id: user.id, notification_event_id: event.id, notification_inbox_item_id: inbox.id, state: "failed", due_at: now, last_error: "Socket timeout", created_at: now, updated_at: now } })
  const cutoff = new Date(now.getTime() + 60000)
  const jobs = () => prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM pgboss.job WHERE name=${NOTIFICATION_DELAYED_PUSH_QUEUE} AND data @> ${JSON.stringify({ deliveryId: delivery.id })}::jsonb`
  try {
    await boss.start()
    await prisma.notificationPushDelivery.update({where:{id:delivery.id},data:{state:"partial"}})
    expect(await recoverPushDelivery(prisma,boss,delivery.id,cutoff,true)).toEqual({outcome:"no_retryable_devices"})
    expect(await schedulePushDelivery(prisma,boss,delivery.id)).toBe(false)
    expect(await jobs()).toEqual([])
    const devices=await prisma.notificationPushDeviceAttempt.createManyAndReturn({data:["sent","rejected","uncertain"].map((state,index)=>({delivery_id:delivery.id,subscription_id:index+1,endpoint_hash:String(index+1).repeat(64),state:state as "sent"|"rejected"|"uncertain",started_at:now,completed_at:now}))})
    expect(await recoverPushDelivery(prisma,boss,delivery.id,cutoff)).toEqual({outcome:"eligible",uncertain_external_outcome:true,device_outcomes:{sent:1,rejected:1,uncertain:1}})
    const partialAttempts=await Promise.all([recoverPushDelivery(prisma,boss,delivery.id,cutoff,true),recoverPushDelivery(prisma,boss,delivery.id,cutoff,true)])
    expect(partialAttempts.map(result=>result.outcome).sort()).toEqual(["enqueued","not_failed"])
    expect(await jobs()).toHaveLength(1)
    expect(await prisma.notificationPushDeviceAttempt.findMany({where:{delivery_id:delivery.id},orderBy:{id:"asc"}})).toEqual(devices.sort((a,b)=>a.id-b.id))
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name=${NOTIFICATION_DELAYED_PUSH_QUEUE} AND data @> ${JSON.stringify({deliveryId:delivery.id})}::jsonb`
    const unfinished=await prisma.notificationPushDeviceAttempt.create({data:{delivery_id:delivery.id,subscription_id:4,endpoint_hash:"d".repeat(64),started_at:now}})
    await prisma.notificationPushDelivery.update({where:{id:delivery.id},data:{state:"sending"}})
    expect(await recoverPushDelivery(prisma,boss,delivery.id,cutoff,true)).toEqual({outcome:"worker_stop_confirmation_required"})
    expect(await recoverPushDelivery(prisma,boss,delivery.id,cutoff,false,{workerStopped:true})).toMatchObject({outcome:"eligible",unfinished_attempts_held:1})
    const interruptedRecovery={hasOutstandingJob:boss.hasOutstandingJob.bind(boss),enqueueInTransaction:async(...args:Parameters<BossService["enqueueInTransaction"]>)=>{await boss.enqueueInTransaction(...args);throw Error("Recovery interrupted")}}
    await expect(recoverPushDelivery(prisma,interruptedRecovery,delivery.id,cutoff,true,{workerStopped:true})).rejects.toThrow("Recovery interrupted")
    expect(await prisma.notificationPushDeviceAttempt.findUniqueOrThrow({where:{id:unfinished.id}})).toEqual(unfinished)
    expect(await jobs()).toEqual([])
    expect(await recoverPushDelivery(prisma,boss,delivery.id,cutoff,true,{workerStopped:true})).toMatchObject({outcome:"enqueued",unfinished_attempts_held:1})
    expect(await prisma.notificationPushDeviceAttempt.findUniqueOrThrow({where:{id:unfinished.id}})).toMatchObject({state:"uncertain",attempt_count:1})
    expect(await prisma.notificationPushDeviceAttempt.findMany({where:{id:{in:devices.map(d=>d.id)}},orderBy:{id:"asc"}})).toEqual(devices)
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name=${NOTIFICATION_DELAYED_PUSH_QUEUE} AND data @> ${JSON.stringify({deliveryId:delivery.id})}::jsonb`
    await prisma.notificationPushDeviceAttempt.deleteMany({where:{delivery_id:delivery.id}})
    await prisma.notificationPushDelivery.update({where:{id:delivery.id},data:{state:"sending"}})
    expect(await recoverPushDelivery(prisma,boss,delivery.id,cutoff,true,{workerStopped:true})).toEqual({outcome:"interrupted_without_journal"})
    await prisma.notificationPushDelivery.update({where:{id:delivery.id},data:{state:"failed",due_at:delivery.due_at,scheduled_job_id:null,updated_at:delivery.updated_at}})
    expect(await recoverPushDelivery(prisma, boss, delivery.id, cutoff)).toEqual({ outcome: "eligible", uncertain_external_outcome: true })
    const target = new URL(process.env.DATABASE_URL!)
    const args = ["--import", "tsx", "bin/recover-push-delivery.mjs", "--database", decodeURIComponent(target.pathname.slice(1)), "--delivery-id", String(delivery.id), "--before", cutoff.toISOString()]
    const denied = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, PUSH_RECOVERY_DATABASE_URL: "" } })
    expect(denied.status).toBe(1)
    const preview = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, PUSH_RECOVERY_DATABASE_URL: target.toString() } })
    expect(preview.status, preview.stderr).toBe(0)
    expect(JSON.parse(preview.stdout)).toMatchObject({ dry_run: true, outcome: "eligible", deliveryId: delivery.id })
    expect(await jobs()).toEqual([])
    expect(await prisma.notificationPushDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).toEqual(delivery)
    expect(await recoverPushDelivery(prisma, boss, delivery.id, new Date(now.getTime() - 1), true)).toEqual({ outcome: "newer_than_cutoff" })
    const interrupted = { hasOutstandingJob: boss.hasOutstandingJob.bind(boss), enqueueInTransaction: async (...args: Parameters<BossService["enqueueInTransaction"]>) => { await boss.enqueueInTransaction(...args); throw Error("Interrupted after enqueue") } }
    await expect(recoverPushDelivery(prisma, interrupted, delivery.id, cutoff, true)).rejects.toThrow("Interrupted after enqueue")
    expect(await jobs()).toEqual([])
    expect(await prisma.notificationPushDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).toEqual(delivery)
    const attempts = await Promise.allSettled(Array.from({ length: 4 }, () => recoverPushDelivery(prisma, boss, delivery.id, cutoff, true)))
    expect(attempts.filter(attempt => attempt.status === "rejected")).toEqual([])
    const outcomes = attempts.map(attempt => { if (attempt.status === "rejected") throw attempt.reason; return attempt.value.outcome })
    expect(outcomes.filter(outcome => outcome === "enqueued")).toHaveLength(1)
    expect(outcomes.filter(outcome => outcome === "not_failed")).toHaveLength(3)
    const pending = await jobs(); expect(pending).toHaveLength(1)
    expect(await prisma.notificationPushDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ state: "scheduled", scheduled_job_id: pending[0].id, last_error: "Socket timeout" })
    await prisma.notificationPushDelivery.update({ where: { id: delivery.id }, data: { state: "failed" } })
    expect(await recoverPushDelivery(prisma, boss, delivery.id, cutoff, true)).toEqual({ outcome: "outstanding_job" })
    expect(await jobs()).toEqual(pending)
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name=${NOTIFICATION_DELAYED_PUSH_QUEUE} AND data @> ${JSON.stringify({ deliveryId: delivery.id })}::jsonb`
    const due = new Date(Date.now() + 120000)
    await prisma.notificationPushDelivery.update({ where: { id: delivery.id }, data: { state: "scheduled", scheduled_job_id: null, due_at: due } })
    await expect(schedulePushDelivery(prisma, interrupted, delivery.id)).rejects.toThrow("Interrupted after enqueue")
    expect(await jobs()).toEqual([])
    expect((await prisma.notificationPushDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).scheduled_job_id).toBeNull()
    const scheduled = await Promise.all([schedulePushDelivery(prisma, boss, delivery.id), schedulePushDelivery(prisma, boss, delivery.id)])
    expect(scheduled.sort()).toEqual([false, true])
    const [job] = await jobs()
    const [stored] = await prisma.$queryRaw<Array<{ start_after: Date }>>`SELECT start_after FROM pgboss.job WHERE id=${job.id}::uuid`
    expect(stored.start_after).toEqual(due)
    await prisma.notificationPushDelivery.update({ where: { id: delivery.id }, data: { state: "cancelled" } })
    expect(await schedulePushDelivery(prisma, boss, delivery.id)).toBe(false)
    expect(await jobs()).toEqual([job])
  } finally {
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name=${NOTIFICATION_DELAYED_PUSH_QUEUE} AND data @> ${JSON.stringify({ deliveryId: delivery.id })}::jsonb`
    await boss.onModuleDestroy()
    await prisma.notificationPushDelivery.delete({ where: { id: delivery.id } })
    await prisma.notificationInboxItem.delete({ where: { id: inbox.id } })
    await prisma.notificationEvent.delete({ where: { id: event.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
}, 15000)
