import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { beginPushDeviceAttempt, completePushDeviceAttempt } from "@server/notifications/push-device-journal"

it("serializes destination attempts and fences completed, uncertain and superseded sends",async()=>{
 const prisma=new PrismaService(),now=new Date()
 const user=await prisma.user.create({data:{email:`${crypto.randomUUID()}@push-device.test`,username:"Recipient",created_at:now,updated_at:now}})
 const room=await prisma.room.create({data:{name:"Room",owner_id:user.id,created_at:now,updated_at:now}})
 const event=await prisma.notificationEvent.create({data:{event_type:"post_created",actor_id:user.id,room_id:room.id,created_at:now,updated_at:now}})
 const inbox=await prisma.notificationInboxItem.create({data:{user_id:user.id,notification_event_id:event.id,created_at:now,updated_at:now}})
 const delivery=await prisma.notificationPushDelivery.create({data:{user_id:user.id,notification_event_id:event.id,notification_inbox_item_id:inbox.id,state:"sending",due_at:now,created_at:now,updated_at:now}})
 try{
  const claims=await Promise.all(Array.from({length:5},(_,i)=>beginPushDeviceAttempt(prisma,delivery.id,100+i,"https://example.test/device")))
  expect(claims.filter(result=>result.claimed)).toHaveLength(1)
  expect(new Set(claims.map(result=>result.attempt.id)).size).toBe(1)
  const first=claims[0].attempt
  expect(first.endpoint_hash).toMatch(/^[a-f0-9]{64}$/)
  expect(await completePushDeviceAttempt(prisma,first.id,1,"sent")).toBe(true)
  expect(await completePushDeviceAttempt(prisma,first.id,1,"uncertain")).toBe(false)
  expect((await beginPushDeviceAttempt(prisma,delivery.id,999,"https://example.test/device")).claimed).toBe(false)
  const rejected=await beginPushDeviceAttempt(prisma,delivery.id,200,"https://example.test/retry")
  expect(await completePushDeviceAttempt(prisma,rejected.attempt.id,1,"rejected","HTTP 429")).toBe(true)
  const retry=await beginPushDeviceAttempt(prisma,delivery.id,200,"https://example.test/retry")
  expect(retry).toMatchObject({claimed:true,attempt:{attempt_count:2,state:"started",last_error:null,completed_at:null}})
  expect(await completePushDeviceAttempt(prisma,retry.attempt.id,1,"sent")).toBe(false)
  expect(await completePushDeviceAttempt(prisma,retry.attempt.id,2,"uncertain","Socket timeout")).toBe(true)
  expect((await beginPushDeviceAttempt(prisma,delivery.id,200,"https://example.test/retry")).claimed).toBe(false)
  await prisma.notificationPushDelivery.update({where:{id:delivery.id},data:{state:"scheduled"}})
  await expect(beginPushDeviceAttempt(prisma,delivery.id,300,"https://example.test/unclaimed")).rejects.toThrow("must be claimed")
  expect(await prisma.notificationPushDeviceAttempt.count({where:{delivery_id:delivery.id}})).toBe(2)
 }finally{
  await prisma.notificationPushDelivery.delete({where:{id:delivery.id}})
  await prisma.notificationInboxItem.delete({where:{id:inbox.id}})
  await prisma.notificationEvent.delete({where:{id:event.id}})
  await prisma.room.delete({where:{id:room.id}})
  await prisma.user.delete({where:{id:user.id}})
  await prisma.$disconnect()
 }
},20000)
