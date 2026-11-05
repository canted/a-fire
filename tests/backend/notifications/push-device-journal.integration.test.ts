import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"

it("enforces unique device outcomes and valid attempt lifecycle without storing credentials",async()=>{
 const prisma=new PrismaService(),now=new Date(),rollback=new Error("rollback device journal")
 try{
  await prisma.$transaction(async tx=>{
   const user=await tx.user.create({data:{email:`${crypto.randomUUID()}@push-journal.test`,username:"Recipient",created_at:now,updated_at:now}})
   const room=await tx.room.create({data:{name:"Room",owner_id:user.id,created_at:now,updated_at:now}})
   const event=await tx.notificationEvent.create({data:{event_type:"post_created",actor_id:user.id,room_id:room.id,created_at:now,updated_at:now}})
   const inbox=await tx.notificationInboxItem.create({data:{user_id:user.id,notification_event_id:event.id,created_at:now,updated_at:now}})
   const delivery=await tx.notificationPushDelivery.create({data:{user_id:user.id,notification_event_id:event.id,notification_inbox_item_id:inbox.id,state:"scheduled",due_at:now,created_at:now,updated_at:now}})
   const data={delivery_id:delivery.id,subscription_id:123,endpoint_hash:"a".repeat(64),started_at:now}
   const attempt=await tx.notificationPushDeviceAttempt.create({data})
   expect(attempt).toMatchObject({state:"started",attempt_count:1,completed_at:null})
   async function rejected(action:()=>Promise<unknown>,constraint="push_device_attempt_identity_check"){
    await tx.$executeRawUnsafe("SAVEPOINT rejected_attempt")
    try{if(constraint==="P2002")await expect(action()).rejects.toMatchObject({code:"P2002"});else await expect(action()).rejects.toThrow(constraint)}finally{await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT rejected_attempt")}
   }
   await rejected(()=>tx.notificationPushDeviceAttempt.create({data:{...data,subscription_id:456}}),"P2002")
   await rejected(()=>tx.notificationPushDeviceAttempt.create({data:{...data,endpoint_hash:"invalid"}}))
   await rejected(()=>tx.notificationPushDeviceAttempt.update({where:{id:attempt.id},data:{attempt_count:0}}))
   await rejected(()=>tx.notificationPushDeviceAttempt.update({where:{id:attempt.id},data:{state:"sent"}}),"push_device_attempt_completion_check")
   await rejected(()=>tx.notificationPushDeviceAttempt.update({where:{id:attempt.id},data:{state:"uncertain",completed_at:new Date(+now-1)}}),"push_device_attempt_completion_check")
   await tx.notificationPushDeviceAttempt.update({where:{id:attempt.id},data:{state:"sent",completed_at:now}})
   expect((await tx.notificationPushDeviceAttempt.findUniqueOrThrow({where:{id:attempt.id}})).state).toBe("sent")
   expect(await tx.notificationPushDelivery.findUniqueOrThrow({where:{id:delivery.id}})).toEqual(delivery)
   throw rollback
  },{timeout:15000})
 }catch(error){if(error!==rollback)throw error}finally{await prisma.$disconnect()}
},20000)
