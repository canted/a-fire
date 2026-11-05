import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { homeRoomCounts } from "@server/api/v1/projects/home-room-counts"

it("aggregates distinct Room activity using exact local-year boundaries", async () => {
  const prisma = new PrismaService(), rollback = new Error("Rollback dashboard fixture")
  const at = new Date("2026-01-01T00:30:00Z")
  try {
    await expect(prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { username: "Counts", email: `${crypto.randomUUID()}@counts.test`, created_at: at, updated_at: at } })
      const room = await tx.room.create({ data: { owner_id: user.id, name: "Counts", created_at: at, updated_at: at } })
      const post = await tx.entry.create({ data: { user_id: user.id, room_id: room.id, created_at: at, updated_at: at, status: "published", published_at: at } })
      const round = await tx.round.create({ data: { host_id: user.id, room_id: room.id, name: "Round", created_at: at, updated_at: at } })
      await tx.activityParticipation.create({ data: { user_id: user.id, round_id: round.id, role: "participant", joined_at: at, created_at: at, updated_at: at } })
      await tx.activitySubmission.createMany({ data: Array.from({ length: 3 }, () => ({ user_id: user.id, round_id: round.id, entry_id: post.id, submitted_at: at, created_at: at, updated_at: at })) })
      await tx.reply.createMany({ data: Array.from({ length: 1000 }, () => ({ user_id: user.id, entry_id: post.id, status: "published", published_at: at, created_at: at, updated_at: at })) })
      await tx.reply.create({ data: { user_id: user.id, entry_id: post.id, status: "draft", published_at: at, created_at: at, updated_at: at } })
      const expected = { activitiesJoined: 1, feedbackGiven: 1000, entriesShared: 1 }
      expect(await homeRoomCounts(tx, user.id, [room.id], 2026, "UTC")).toEqual(expected)
      expect(await homeRoomCounts(tx, user.id, [room.id], 2025, "America/Los_Angeles")).toEqual(expected)
      expect(await homeRoomCounts(tx, user.id, [room.id], 2026, "America/Los_Angeles")).toEqual({ activitiesJoined: 0, feedbackGiven: 0, entriesShared: 0 })
      expect(await homeRoomCounts(tx, user.id, [], 2026, "UTC")).toEqual({ activitiesJoined: 0, feedbackGiven: 0, entriesShared: 0 })
      const other=await tx.room.create({data:{name:"Other",created_at:at,updated_at:at}})
      const scopedPosts=await tx.entry.createManyAndReturn({data:[
        {room_id:room.id},
        {room_id:other.id},
      ].map(scope=>({...scope,user_id:user.id,status:"published",published_at:at,created_at:at,updated_at:at}))})
      await tx.reply.createMany({data:scopedPosts.map(p=>({entry_id:p.id,user_id:user.id,status:"published",published_at:at,created_at:at,updated_at:at}))})
      expect(await homeRoomCounts(tx,user.id,[room.id],2026,"UTC")).toEqual({...expected,feedbackGiven:1001})
      expect(await homeRoomCounts(tx,user.id,[other.id],2026,"UTC")).toEqual({activitiesJoined:0,feedbackGiven:1,entriesShared:0})
      for(const retained of scopedPosts) expect(await tx.entry.findUniqueOrThrow({where:{id:retained.id}})).toEqual(retained)
      throw rollback
    }, { timeout: 15000 })).rejects.toBe(rollback)
  } finally { await prisma.$disconnect() }
})
