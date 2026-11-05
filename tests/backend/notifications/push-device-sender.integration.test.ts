import "reflect-metadata"
import { createHash } from "node:crypto"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { NotificationDeliveryService } from "@server/notifications/notification-delivery.service"
import { recoverPushDelivery } from "@server/notifications/recover-push-delivery"
import { BossService } from "@server/queue/boss.service"
import { NOTIFICATION_DELAYED_PUSH_QUEUE } from "@server/notifications/notification-delivery.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"

it("journals real sender outcomes and retries only rejected destinations",async()=>{
 const prisma=new PrismaService(),now=new Date()
 const user=await prisma.user.create({data:{email:`${crypto.randomUUID()}@push-send.test`,username:"Recipient",created_at:now,updated_at:now}})
 const room=await prisma.room.create({data:{name:"Room",owner_id:user.id,created_at:now,updated_at:now}})
 const event=await prisma.notificationEvent.create({data:{event_type:"post_created",actor_id:user.id,room_id:room.id,created_at:now,updated_at:now}})
 const inbox=await prisma.notificationInboxItem.create({data:{user_id:user.id,notification_event_id:event.id,created_at:now,updated_at:now}})
 const delivery=await prisma.notificationPushDelivery.create({data:{user_id:user.id,notification_event_id:event.id,notification_inbox_item_id:inbox.id,state:"scheduled",due_at:now,created_at:now,updated_at:now}})

 const env={public:process.env.VITE_VAPID_PUBLIC_KEY,private:process.env.VITE_VAPID_PRIVATE_KEY,subject:process.env.VITE_VAPID_SUBJECT}
 const boss=new BossService()
 const service=new NotificationDeliveryService(),access=new RoomAccessService();Object.assign(access,{prisma})
 const sender=vi.fn(async(subscription:{endpoint:string})=>{
  if(subscription.endpoint.endsWith("rejected"))throw {statusCode:429}
  if(subscription.endpoint.endsWith("uncertain"))throw Error("Socket timeout")
 })
 Object.assign(service,{prisma,circleAccess:access,sendWithVapidFallback:sender,realtime:{isUserActive:()=>false},preferences:{resolveForUser:async()=>({pushEnabled:true}),allowsEvent:()=>true},unseenContent:{countForUser:async()=>({total:1})}})
 let postId:number|undefined
 try{
  process.env.VITE_VAPID_PUBLIC_KEY="test";process.env.VITE_VAPID_PRIVATE_KEY="test";process.env.VITE_VAPID_SUBJECT="mailto:test@example.test"
  await prisma.roomMembership.create({data:{user_id:user.id,room_id:room.id,created_at:now,updated_at:now}})
  const post=await prisma.entry.create({data:{user_id:user.id,room_id:room.id,status:"published",published_at:now,created_at:now,updated_at:now}});postId=post.id
  await prisma.notificationEvent.update({where:{id:event.id},data:{entry_id:post.id}})
  await prisma.pushSubscription.createMany({data:["sent","sent","rejected","uncertain"].map(name=>({user_id:user.id,endpoint:`https://example.test/${name}`,p256dh:"test",auth:"test",subscribed:true,created_at:now,updated_at:now}))})
  await service.handleDelayedPush(delivery.id)
  expect(sender).toHaveBeenCalledTimes(3)
  expect((await prisma.notificationPushDelivery.findUniqueOrThrow({where:{id:delivery.id}})).state).toBe("partial")
  const attempts=await prisma.notificationPushDeviceAttempt.findMany({where:{delivery_id:delivery.id}})
  expect(attempts.map(a=>a.state).sort()).toEqual(["rejected","sent","uncertain"])
  sender.mockReset().mockResolvedValue(undefined)
  await boss.start()
  expect(await recoverPushDelivery(prisma,boss,delivery.id,new Date(Date.now()+60000),true)).toMatchObject({outcome:"enqueued",device_outcomes:{sent:1,rejected:1,uncertain:1}})
  await service.handleDelayedPush(delivery.id)
  expect(sender).toHaveBeenCalledTimes(1)
  expect(sender.mock.calls[0][0].endpoint).toBe("https://example.test/rejected")
  const after=await prisma.notificationPushDeviceAttempt.findMany({where:{delivery_id:delivery.id}})
  expect(after.filter(a=>a.state==="sent")).toHaveLength(2)
  expect(after.find(a=>a.id===attempts.find(a=>a.state==="rejected")!.id)?.attempt_count).toBe(2)
  expect(after.find(a=>a.state==="uncertain")?.attempt_count).toBe(1)
  await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name=${NOTIFICATION_DELAYED_PUSH_QUEUE} AND data @> ${JSON.stringify({deliveryId:delivery.id})}::jsonb`
  const interrupted=await prisma.pushSubscription.create({data:{user_id:user.id,endpoint:"https://example.test/interrupted",p256dh:"test",auth:"test",subscribed:true,created_at:now,updated_at:now}})
  await prisma.notificationPushDeviceAttempt.create({data:{delivery_id:delivery.id,subscription_id:interrupted.id,endpoint_hash:createHash("sha256").update("https://example.test/interrupted").digest("hex"),state:"started",started_at:now}})
  await prisma.pushSubscription.create({data:{user_id:user.id,endpoint:"https://example.test/untouched",p256dh:"test",auth:"test",subscribed:true,created_at:now,updated_at:now}})
  await prisma.notificationPushDelivery.update({where:{id:delivery.id},data:{state:"sending"}})
  expect(await recoverPushDelivery(prisma,boss,delivery.id,new Date(Date.now()+60000),true,{workerStopped:true})).toMatchObject({outcome:"enqueued",unfinished_attempts_held:1})
  sender.mockClear()
  await service.handleDelayedPush(delivery.id)
  expect(sender).toHaveBeenCalledTimes(1)
  expect(sender.mock.calls[0][0].endpoint).toBe("https://example.test/untouched")
  expect(await prisma.notificationPushDeviceAttempt.findFirst({where:{delivery_id:delivery.id,subscription_id:interrupted.id}})).toMatchObject({state:"uncertain",attempt_count:1})
  await prisma.pushSubscription.createMany({data:["new-one","new-two"].map(name=>({user_id:user.id,endpoint:`https://example.test/${name}`,p256dh:"test",auth:"test",subscribed:true,created_at:now,updated_at:new Date(+now+5000)}))})
  sender.mockReset().mockImplementation(async()=>{await prisma.roomMembership.updateMany({where:{user_id:user.id,room_id:room.id},data:{disabled:true}})})
  await prisma.notificationPushDelivery.update({where:{id:delivery.id},data:{state:"scheduled"}})
  await service.handleDelayedPush(delivery.id)
  expect(sender).toHaveBeenCalledTimes(1)
  expect(await prisma.notificationPushDelivery.findUniqueOrThrow({where:{id:delivery.id}})).toMatchObject({state:"cancelled",skip_reason:"content_unavailable"})
 }finally{
  for(const [name,value] of [["VITE_VAPID_PUBLIC_KEY",env.public],["VITE_VAPID_PRIVATE_KEY",env.private],["VITE_VAPID_SUBJECT",env.subject]] as const){if(value===undefined)delete process.env[name];else process.env[name]=value}
  await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name=${NOTIFICATION_DELAYED_PUSH_QUEUE} AND data @> ${JSON.stringify({deliveryId:delivery.id})}::jsonb`
  await boss.onModuleDestroy()
  await prisma.pushSubscription.deleteMany({where:{user_id:user.id}})
  await prisma.notificationPushDelivery.delete({where:{id:delivery.id}})
  await prisma.notificationInboxItem.delete({where:{id:inbox.id}})
  await prisma.notificationEvent.delete({where:{id:event.id}})
  if(postId)await prisma.entry.delete({where:{id:postId}})
  await prisma.roomMembership.deleteMany({where:{room_id:room.id}})
  await prisma.room.delete({where:{id:room.id}})
  await prisma.user.delete({where:{id:user.id}})
  await prisma.$disconnect()
 }
},20000)
