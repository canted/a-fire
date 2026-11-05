import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { NotificationDeliveryService } from "@server/notifications/notification-delivery.service"

it("claims a delivery once across concurrent workers and releases only preparation failures",async()=>{
 const prisma=new PrismaService(),now=new Date()
 const user=await prisma.user.create({data:{email:`${crypto.randomUUID()}@push-claim.test`,username:"Recipient",created_at:now,updated_at:now}})
 const room=await prisma.room.create({data:{name:"Room",owner_id:user.id,created_at:now,updated_at:now}})
 const event=await prisma.notificationEvent.create({data:{event_type:"post_created",actor_id:user.id,room_id:room.id,created_at:now,updated_at:now}})
 const inbox=await prisma.notificationInboxItem.create({data:{user_id:user.id,notification_event_id:event.id,created_at:now,updated_at:now}})
 const delivery=await prisma.notificationPushDelivery.create({data:{user_id:user.id,notification_event_id:event.id,notification_inbox_item_id:inbox.id,state:"scheduled",due_at:now,created_at:now,updated_at:now}})
 const service=new NotificationDeliveryService()
 Object.assign(service,{prisma,realtime:{isUserActive:()=>false},preferences:{resolveForUser:async()=>({pushEnabled:true}),allowsEvent:()=>true},unseenContent:{countForUser:async()=>({total:1})}})
 try{
  const prepare=vi.fn().mockRejectedValue(new Error("Preparation failed"));Object.assign(service,{sendPush:prepare})
  await expect(service.handleDelayedPush(delivery.id)).rejects.toThrow("Preparation failed")
  expect((await prisma.notificationPushDelivery.findUniqueOrThrow({where:{id:delivery.id}})).state).toBe("scheduled")
  // All workers observe the same stale scheduled snapshot; only the SQL claim may arbitrate.
  const snapshot=await prisma.notificationPushDelivery.findUniqueOrThrow({where:{id:delivery.id},include:{notification_event:{include:{actor:true,room:true}}}})
  Object.assign(service,{prisma:new Proxy(prisma,{get(target,key){
   if(key==="notificationPushDelivery")return {...target.notificationPushDelivery,findUnique:async()=>snapshot}
   return Reflect.get(target,key)
  }})})
  let release!:()=>void, started!:()=>void
  const gate=new Promise<void>(resolve=>{release=resolve}), entered=new Promise<void>(resolve=>{started=resolve})
  const send=vi.fn(async(_user:unknown,_event:unknown,_count:unknown,_id:unknown,options:{onExternalAttempt:()=>void})=>{
   options.onExternalAttempt();started();await gate
   await prisma.notificationPushDelivery.update({where:{id:delivery.id},data:{state:"sent"}})
  });Object.assign(service,{sendPush:send})
  const first=service.handleDelayedPush(delivery.id)
  await entered
  try{await Promise.all(Array.from({length:4},()=>service.handleDelayedPush(delivery.id)));expect(send).toHaveBeenCalledTimes(1)}finally{release();await first}
  await prisma.notificationPushDelivery.update({where:{id:delivery.id},data:{state:"scheduled"}})
  const uncertain=vi.fn(async(_u:unknown,_e:unknown,_c:unknown,_i:unknown,options:{onExternalAttempt:()=>void})=>{options.onExternalAttempt();throw Error("Lost completion")})
  Object.assign(service,{sendPush:uncertain})
  await expect(service.handleDelayedPush(delivery.id)).rejects.toThrow("Lost completion")
  expect((await prisma.notificationPushDelivery.findUniqueOrThrow({where:{id:delivery.id}})).state).toBe("sending")
  await service.handleDelayedPush(delivery.id);expect(uncertain).toHaveBeenCalledTimes(1)
 }finally{
  await prisma.notificationPushDelivery.delete({where:{id:delivery.id}})
  await prisma.notificationInboxItem.delete({where:{id:inbox.id}})
  await prisma.notificationEvent.delete({where:{id:event.id}})
  await prisma.room.delete({where:{id:room.id}})
  await prisma.user.delete({where:{id:user.id}})
  await prisma.$disconnect()
 }
},20000)
