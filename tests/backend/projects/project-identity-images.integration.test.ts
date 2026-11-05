import { Prisma } from "@prisma/client"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { projectIdentityImages } from "@server/api/v1/uploads/identity-images"

it("returns only the latest Project icon/banner despite large retained attachment history", async()=>{
 const prisma=new PrismaService(),now=new Date(),rollback=new Error("rollback Project image fixture")
 try{
  await prisma.$transaction(async tx=>{
   const user=await tx.user.create({data:{email:`${crypto.randomUUID()}@project-images.test`,username:"Owner",created_at:now,updated_at:now}})
   const project=await tx.project.create({data:{owner_id:user.id,name:"Images",created_at:now,updated_at:now}})
   const blobs=await tx.activeStorageBlob.createManyAndReturn({data:[0,1].map(i=>({key:crypto.randomUUID(),filename:`${i}.png`,byte_size:1,service_name:"test",content_type:"image/png",metadata:JSON.stringify({width:100+i,height:200+i,contentType:"image/png"}),created_at:now}))})
   await tx.activeStorageAttachment.createMany({data:Array.from({length:2048},(_,i)=>({record_type:"Project",record_id:project.id,name:i%2?"icon":"banner",blob_id:blobs[0].id,created_at:now}))})
   await tx.activeStorageAttachment.createMany({data:["icon","banner"].map(name=>({record_type:"Project",record_id:project.id,name,blob_id:blobs[1].id,created_at:now}))})
   await tx.activeStorageBlob.createMany({data:Array.from({length:4096},()=>({key:crypto.randomUUID(),filename:"unrelated.png",byte_size:1,service_name:"test",created_at:now}))})
   await tx.$executeRaw`SET LOCAL plan_cache_mode = force_generic_plan`
   let query:Prisma.Sql|undefined
   const measured={$queryRaw:async(sql:Prisma.Sql)=>{query=sql;return tx.$queryRaw(sql)}} as Pick<typeof tx,"$queryRaw">
   const rows=await projectIdentityImages(measured,[project.id,project.id])
   expect(rows).toHaveLength(2)
   expect(rows.map(row=>row.name).sort()).toEqual(["banner","icon"])
   for(const row of rows)expect(row).toEqual({record_id:project.id,name:row.name,blob_id:blobs[1].id,active_storage_blobs:{metadata:blobs[1].metadata}})
   expect(await projectIdentityImages(tx,[])).toEqual([])
   expect(await tx.activeStorageAttachment.count({where:{record_type:"Project",record_id:project.id}})).toBe(2050)
   const plans=await tx.$queryRaw<Array<{"QUERY PLAN":Array<Record<string,any>>}>>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query!}`)
   const summary=plans[0]["QUERY PLAN"][0]
   if(process.env.PROJECT_PAGE_EXPLAIN==="1")process.stdout.write(JSON.stringify(summary)+"\n")
   const nodes=(node:Record<string,any>):Array<Record<string,any>>=>[node,...(node.Plans??[]).flatMap(nodes)]
   const scans=nodes(summary.Plan).filter(node=>node["Relation Name"]==="active_storage_attachments")
   expect(scans.length).toBeGreaterThan(0)
   expect(scans.every(node=>node["Index Name"]==="index_attachments_on_identity_latest")).toBe(true)
   expect(scans.reduce((sum,node)=>sum+node["Actual Rows"]*node["Actual Loops"],0)).toBe(2)
   const blobScans=nodes(summary.Plan).filter(node=>node["Relation Name"]==="active_storage_blobs")
   expect(blobScans.length).toBeGreaterThan(0)
   expect(blobScans.reduce((sum,node)=>sum+(node["Actual Rows"]+(node["Rows Removed by Filter"]??0))*node["Actual Loops"],0)).toBeLessThanOrEqual(2)
   expect(summary.Plan["Temp Written Blocks"]).toBe(0)
   process.stdout.write(JSON.stringify({projectIdentityPlan:{history:2050,returned:summary.Plan["Actual Rows"],executionMs:summary["Execution Time"],sharedHits:summary.Plan["Shared Hit Blocks"]}})+"\n")
   throw rollback
  },{timeout:15000})
 }catch(error){if(error!==rollback)throw error}finally{await prisma.$disconnect()}
},20000)
