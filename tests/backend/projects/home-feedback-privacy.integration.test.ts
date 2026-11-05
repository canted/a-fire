import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { HomeService } from "@server/api/v1/projects/home.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"

it("Home feedback previews obey real Chat lifetime and inaccessible Room scope", async () => {
 const prisma=new PrismaService(), now=new Date(), rollback=new Error("rollback Home privacy")
 try {
  await prisma.$transaction(async tx=>{
   const user=await tx.user.create({data:{email:`${crypto.randomUUID()}@home-privacy.test`,username:"Owner",created_at:now,updated_at:now}})
   const peer=await tx.user.create({data:{email:`${crypto.randomUUID()}@home-privacy.test`,username:"Peer",created_at:now,updated_at:now}})
   const room=await tx.room.create({data:{name:"Room",owner_id:user.id,created_at:now,updated_at:now}})
   await tx.roomMembership.create({data:{room_id:room.id,user_id:user.id,created_at:now,updated_at:now}})
   const post=await tx.entry.create({data:{user_id:user.id,room_id:room.id,status:"published",creation_origin:"chat_attachment",published_at:now,created_at:now,updated_at:now}})
   const reply=await tx.reply.create({data:{user_id:peer.id,entry_id:post.id,status:"published",published_at:now,created_at:now,updated_at:now}})
   await tx.document.create({data:{docable_type:"Reply",docable_id:reply.id,content:{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"Private feedback"}]}]},created_at:now,updated_at:now}})
   const message=await tx.chatMessage.create({data:{entry_id:post.id,room_id:room.id,author_id:user.id,body:"",masked_alias:"",content:{type:"image"},created_at:now,updated_at:now,fire_at:now,expires_at:new Date(+now+86400000)}})
   const circleAccess=new RoomAccessService();Object.assign(circleAccess,{prisma:tx})
   const service=new HomeService();Object.assign(service,{prisma:tx,circleAccess,
    projects:{homeSummaries:async()=>[]},entries:{},rounds:{},
    unseen:{countResponsesToOwnPosts:async()=>0,countForUserWithRooms:async()=>({overall:{total:0},byRoom:new Map()})}})
   expect((await service.snapshot(user.id)).recentFeedback?.preview).toBe("Private feedback")
   await tx.chatMessage.update({where:{id:message.id},data:{created_at:new Date(+now-15*86400000),pinned_at:now}})
   expect((await service.snapshot(user.id)).recentFeedback).toBeNull()
   await tx.entry.update({where:{id:post.id},data:{creation_origin:null}})
   expect((await service.snapshot(user.id)).recentFeedback?.replyId).toBe(reply.id)
   const other=await tx.room.create({data:{name:"Other",created_at:now,updated_at:now}})
   await tx.entry.update({where:{id:post.id},data:{room_id:other.id}})
   expect((await service.snapshot(user.id)).recentFeedback).toBeNull()
   expect(await tx.reply.findUniqueOrThrow({where:{id:reply.id}})).toEqual(reply)
   throw rollback
  },{timeout:15000})
 }catch(error){if(error!==rollback)throw error}
 finally{await prisma.$disconnect()}
},20000)
