import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { ProjectsService } from "@server/api/v1/projects/projects.service"

it("hydrates current Project collaborators without loading removed participation history", async()=>{
 const prisma=new PrismaService(),now=new Date(),rollback=new Error("rollback participation history")
 try{
  await prisma.$transaction(async tx=>{
   const users=await tx.user.createManyAndReturn({data:Array.from({length:1003},(_,i)=>({email:`${crypto.randomUUID()}@participants.test`,username:`Member ${i}`,created_at:now,updated_at:now}))})
   const [owner,accepted,pending,...former]=users
   const project=await tx.project.create({data:{owner_id:owner.id,name:"Retained history",created_at:now,updated_at:now}})
   await tx.projectParticipation.createMany({data:users.slice(1).map(user=>({project_id:project.id,user_id:user.id,invited_by_id:owner.id,status:user.id===accepted.id?"accepted":user.id===pending.id?"pending":"removed",invited_at:now,created_at:now,updated_at:now}))})
   let hydrated=0
   const database={...tx,$queryRaw:tx.$queryRaw.bind(tx),project:{...tx.project,findMany:async(args:Parameters<typeof tx.project.findMany>[0])=>{
    const rows=await tx.project.findMany(args)
    for(const row of rows as unknown as Array<{participations:unknown[];owner:Record<string,unknown>}>) {
     hydrated+=row.participations.length
     expect(Object.keys(row.owner).sort()).toEqual(["id","username"])
    }
    return rows
   }}}
   const service=new ProjectsService();Object.assign(service,{prisma:database})
   const listed=await service.listMine(owner.id)
   expect(hydrated).toBe(2)
   expect(listed.projects[0].participants).toEqual([{id:accepted.id,username:accepted.username}])
   expect(listed.projects[0].pending_participants).toEqual([{id:pending.id,username:pending.username}])
   expect((await service.show(project.id,accepted.id)).viewer_participation).toBe("accepted")
   expect((await service.show(project.id,pending.id)).invitation_only).toBe(true)
   await expect(service.show(project.id,former[0].id)).rejects.toThrow("Project not found")
   expect((await service.listMine(former[0].id)).projects).toEqual([])
   expect(await tx.projectParticipation.count({where:{project_id:project.id}})).toBe(1002)
   throw rollback
  },{timeout:15000})
 }catch(error){if(error!==rollback)throw error}finally{await prisma.$disconnect()}
},20000)
