import { createHash } from "node:crypto"
import type { PrismaClient, PushDeviceAttemptState } from "@prisma/client"

type Database = Pick<PrismaClient, "$transaction">

/** A parent worker claim must already exist. Destination hashes also deduplicate duplicate subscription rows. */
export async function beginPushDeviceAttempt(database: Database, deliveryId: number, subscriptionId: number, endpoint: string) {
  const endpointHash = createHash("sha256").update(endpoint).digest("hex")
  return database.$transaction(async tx => {
    const [delivery] = await tx.$queryRaw<Array<{ state: string }>>`SELECT state FROM notification_push_deliveries WHERE id=${deliveryId} FOR UPDATE`
    if (delivery?.state !== "sending") throw Error("Push delivery must be claimed before attempting a device")
    const existing = await tx.notificationPushDeviceAttempt.findUnique({where:{delivery_id_endpoint_hash:{delivery_id:deliveryId,endpoint_hash:endpointHash}}})
    if (existing && existing.state !== "rejected") return { claimed:false as const, attempt:existing }
    const now=new Date()
    const attempt=existing
      ? await tx.notificationPushDeviceAttempt.update({where:{id:existing.id},data:{state:"started",subscription_id:subscriptionId,attempt_count:{increment:1},started_at:now,completed_at:null,last_error:null}})
      : await tx.notificationPushDeviceAttempt.create({data:{delivery_id:deliveryId,endpoint_hash:endpointHash,subscription_id:subscriptionId,started_at:now}})
    return {claimed:true as const,attempt}
  })
}

/** Attempt number fences a late completion from an older, explicitly retried attempt. */
export async function completePushDeviceAttempt(database: Database, attemptId: number, attemptNumber: number, state: Exclude<PushDeviceAttemptState,"started">, error: string | null = null) {
  return database.$transaction(async tx => {
    const changed=await tx.$executeRaw`UPDATE notification_push_device_attempts
      SET state=${state}::"PushDeviceAttemptState", completed_at=GREATEST(clock_timestamp() AT TIME ZONE 'UTC',started_at),last_error=${error}
      WHERE id=${attemptId} AND attempt_count=${attemptNumber} AND state='started'`
    return changed===1
  })
}


/** Only explicit rejection statuses permit retry; transport/server ambiguity is held. */
export function pushDeviceFailureState(error: unknown): "invalid" | "rejected" | "uncertain" {
  const status = error && typeof error === "object" ? (error as {statusCode?:unknown}).statusCode : undefined
  if (status === 404 || status === 410) return "invalid"
  return [400,401,403,413,429].includes(status as number) ? "rejected" : "uncertain"
}
