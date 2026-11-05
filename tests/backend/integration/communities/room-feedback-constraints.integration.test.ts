import { Prisma, PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"

it("rejects invalid Room feedback states at the database boundary without changing the row", async () => {
  const prisma = new PrismaClient(), rollback = new Error("Rollback Room constraints"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      const room = await tx.room.create({ data: { name: "Constrained", created_at: now, updated_at: now } })
      const invalid: Prisma.RoomUpdateInput[] = [
        { reply_mode: "audio" },
        { default_idea_guidance: "unknown" },
        { default_feedback_types: Prisma.JsonNull },
        { default_feedback_types: { question: true } },
        { default_feedback_types: "question" },
        { default_feedback_types: ["unknown"] },
        { default_feedback_types: ["question", 1] },
        { reply_mode: "guided", default_feedback_types: [] },
      ]
      for (const data of invalid) {
        await tx.$executeRaw`SAVEPOINT invalid_settings`
        await expect(tx.room.update({ where: { id: room.id }, data })).rejects.toThrow()
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT invalid_settings`
        expect(await tx.room.findUniqueOrThrow({ where: { id: room.id } })).toEqual(room)
      }
      // Stored defaults may be empty while simple mode is active. Switching to
      // guided requires a nonempty selection in the same atomic update.
      await tx.room.update({ where: { id: room.id }, data: { default_feedback_types: [] } })
      await tx.room.update({ where: { id: room.id }, data: { reply_mode: "guided", default_feedback_types: ["idea", "question"], default_idea_guidance: "craft" } })
      expect(await tx.room.findUniqueOrThrow({ where: { id: room.id } })).toMatchObject({ reply_mode: "guided", default_feedback_types: ["idea", "question"], default_idea_guidance: "craft" })
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
