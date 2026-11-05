import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { ProjectEntriesService } from "@server/api/v1/projects/project-entries.service"
import { projectCopyPage } from "@server/api/v1/projects/project-copy-page"
import { Prisma } from "@prisma/client"

it("uses current Room identity and scope for private Entry copy summaries", async () => {
 const prisma=new PrismaService(), now=new Date(), rollback=new Error("rollback copy summary fixture")
 try {
  await prisma.$transaction(async tx => {
   const user=await tx.user.create({data:{email:`${crypto.randomUUID()}@copy-summary.test`,username:"Author",created_at:now,updated_at:now}})
   const room=await tx.room.create({data:{name:"Current Room",owner_id:user.id,created_at:now,updated_at:now}})
   const other=await tx.room.create({data:{name:"Other",created_at:now,updated_at:now}})
   const membership=await tx.roomMembership.create({data:{room_id:room.id,user_id:user.id,created_at:now,updated_at:now}})
   const project=await tx.project.create({data:{name:"Private",owner_id:user.id,created_at:now,updated_at:now}})
   const source=await tx.entry.create({data:{project_id:project.id,user_id:user.id,status:"published",creation_origin:"project_material",created_at:now,updated_at:now}})
   const base={source_entry_id:source.id,user_id:user.id,status:"published",room_id:room.id,created_at:now,updated_at:now,published_at:now}
   const good=await tx.entry.create({data:base})
   const conflict=await tx.entry.create({data:{...base,room_id:other.id}})
   const privateCopy=await tx.entry.create({data:{...base,room_id:null,project_id:project.id}})
   const icons=await tx.activeStorageBlob.createManyAndReturn({data:[0,1].map(i=>({key:crypto.randomUUID(),filename:`${i}.png`,content_type:"image/png",byte_size:1,service_name:"test",created_at:now}))})
   // Equal timestamps require deterministic newest-ID selection.
   for(const icon of icons) await tx.activeStorageAttachment.create({data:{record_type:"Circle",record_id:room.id,name:"avatar",blob_id:icon.id,created_at:now}})
   const service=new ProjectEntriesService();Object.assign(service,{prisma:tx})
   const read=()=>service.show(project.id,source.id,user.id)
   expect((await read()).submissions).toEqual([{id:good.id,room_id:room.id,room_name:"Current Room",circle_icon_url:`/api/v1/uploads/${icons[1].id}/variants/icon160`,round_id:null,reply_count:0,reply_participants:[]}])
   expect((await service.copies(project.id,source.id,user.id)).submissions).toEqual((await read()).submissions)
   const many = await tx.entry.createManyAndReturn({data:Array.from({length:44},()=>({...base,published_at:new Date(now.getTime()+1000)}))})
   const expected=[...many].sort((a,b)=>b.id-a.id).map(post=>post.id).concat(good.id)
   await tx.reply.createMany({data:["published","draft"].map(status=>({entry_id:good.id,user_id:user.id,status,created_at:now,updated_at:now}))})
   const first=await service.copies(project.id,source.id,user.id)
   const embedded=await read()
   expect(embedded.submissions).toEqual(first.submissions)
   expect(embedded.submissions_next_cursor).toBe(first.nextCursor)
   const second=await service.copies(project.id,source.id,user.id,first.nextCursor!)
   const third=await service.copies(project.id,source.id,user.id,second.nextCursor!)
   expect([first.submissions.length,second.submissions.length,third.submissions.length]).toEqual([20,20,5])
   expect([...first.submissions,...second.submissions,...third.submissions].map(post=>post.id)).toEqual(expected)
   expect(third.nextCursor).toBeNull()
   expect(third.submissions.at(-1)?.reply_count).toBe(1)
   expect(third.submissions.at(-1)?.reply_participants).toEqual([{id:user.id,username:"Author"}])
   await expect(service.copies(project.id,source.id,user.id,"bad")).rejects.toThrow("Invalid Project copy cursor")
   await expect(service.copies(project.id,source.id,user.id+1,first.nextCursor!)).rejects.toThrow("Material not found")
   await tx.room.update({where:{id:room.id},data:{name:"Renamed"}})
   expect((await read()).submissions[0].room_name).toBe("Renamed")
   await tx.room.update({where:{id:room.id},data:{deleted_at:now}})
   expect((await read()).submissions).toEqual([])
   expect((await service.copies(project.id,source.id,user.id,first.nextCursor!)).submissions).toEqual([])
   await tx.room.update({where:{id:room.id},data:{deleted_at:null}})
   await tx.roomMembership.update({where:{id:membership.id},data:{disabled:true}})
   expect((await read()).submissions).toEqual([])
   expect((await service.copies(project.id,source.id,user.id,first.nextCursor!)).submissions).toEqual([])
   for(const post of [source,good,conflict,privateCopy]) expect(await tx.entry.findUniqueOrThrow({where:{id:post.id}})).toEqual(post)
   await tx.roomMembership.update({where:{id:membership.id},data:{disabled:false}})
   await tx.entry.createMany({data:Array.from({length:4096},()=>({...base,published_at:new Date(now.getTime()-1000)}))})
   // Plans must reflect this fixture, not statistics left by earlier rolled-back tests.
   await tx.$executeRaw`ANALYZE entries, rooms, room_memberships, replies`
   await tx.$executeRaw`SET LOCAL plan_cache_mode = force_generic_plan`
   let query: Prisma.Sql | undefined
   const measured = { chatMessage:tx.chatMessage, $queryRaw: async (input: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
    const sql = Array.isArray(input) ? Prisma.sql(input as TemplateStringsArray, ...values) : input as Prisma.Sql
    if (sql.sql.includes("WITH page AS MATERIALIZED")) query=sql
    return tx.$queryRaw(sql)
   } } as Pick<typeof tx,"$queryRaw"|"chatMessage">
   expect((await projectCopyPage(measured,project.id,source.id,user.id)).submissions.map(post=>post.id)).toEqual(expected.slice(0,20))
   const plans=await tx.$queryRaw<Array<{"QUERY PLAN":Array<Record<string,any>>}>>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query!}`)
   const summary=plans[0]["QUERY PLAN"][0]
   if(process.env.PROJECT_PAGE_EXPLAIN==="1") process.stdout.write(JSON.stringify(summary)+"\n")
   const nodes=(node:Record<string,any>):Array<Record<string,any>>=>[node,...(node.Plans??[]).flatMap(nodes)]
   expect(summary.Plan["Actual Rows"]).toBe(21)
   expect(summary.Plan["Temp Written Blocks"]).toBe(0)
   expect(nodes(summary.Plan).reduce((sum,node)=>sum+(node["Rows Removed by Join Filter"]??0)*node["Actual Loops"],0)).toBeLessThan(10000)
   // Reply counts must be computed only after selecting the bounded page.
   const replyScans=nodes(summary.Plan).filter(node=>node["Relation Name"]==="replies")
   expect(replyScans.length).toBeGreaterThan(0)
   expect(replyScans.every(node=>node["Actual Loops"]<=21)).toBe(true)
   process.stdout.write(JSON.stringify({projectCopyPagePlan:{copies:4141,returned:summary.Plan["Actual Rows"],executionMs:summary["Execution Time"],sharedHits:summary.Plan["Shared Hit Blocks"]}})+"\n")
   const chatCopies=await tx.entry.createManyAndReturn({data:Array.from({length:20},()=>({...base,creation_origin:"chat_attachment",published_at:new Date(now.getTime()+2000)}))})
   const hidden=await service.copies(project.id,source.id,user.id)
   expect(hidden.submissions).toEqual([])
   expect(hidden.nextCursor).not.toBeNull()
   expect((await read()).submissions).toEqual([])
   expect((await read()).submissions_next_cursor).toBe(hidden.nextCursor)
   expect((await service.copies(project.id,source.id,user.id,hidden.nextCursor!)).submissions.map(p=>p.id)).toEqual(expected.slice(0,20))
   const message=await tx.chatMessage.create({data:{room_id:room.id,author_id:user.id,entry_id:chatCopies[0].id,body:"",masked_alias:"",content:{type:"image"},created_at:now,updated_at:now,fire_at:now,expires_at:new Date(now.getTime()+86400000)}})
   expect((await read()).submissions.map(p=>p.id)).toEqual([chatCopies[0].id])
   await tx.chatMessage.update({where:{id:message.id},data:{created_at:new Date(now.getTime()-15*86400000),pinned_at:now}})
   expect((await read()).submissions).toEqual([])
   expect(await tx.entry.count({where:{id:{in:chatCopies.map(p=>p.id)}}})).toBe(20)
   throw rollback
  },{timeout:15000})
 } catch(error) {if(error!==rollback)throw error}
 finally {await prisma.$disconnect()}
},20000)
