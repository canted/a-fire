import { readFile } from "node:fs/promises"
import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"

it("classifies participation references without granting access or choosing ambiguous ownership", async () => {
  const prisma = new PrismaClient(), rollback = new Error("rollback participation inventory")
  const sql = await readFile("server/prisma/participation-square-inventory.sql", "utf8")
  try {
    await prisma.$transaction(async tx => {
      for (const [table, columns] of [
        ["round_participations", "id integer, round_id integer, square_id integer, user_id integer, submitted_post_id integer"],
        ["rounds", "id integer, board_id integer, circle_id integer"],
        ["boards", "id integer, circle_id integer"], ["circles", "id integer"],
        ["squares", "id integer, board_id integer, circle_id integer, user_id integer"],
        ["circle_memberships", "circle_id integer, user_id integer, disabled boolean"],
      ]) await tx.$executeRawUnsafe(`CREATE TEMP TABLE ${table} (${columns}) ON COMMIT DROP`)
      await tx.$executeRawUnsafe("INSERT INTO circles VALUES (1),(2)")
      await tx.$executeRawUnsafe("INSERT INTO boards VALUES (10,1),(20,2),(40,99)")
      await tx.$executeRawUnsafe("INSERT INTO rounds VALUES (1,NULL,1),(2,20,1),(3,NULL,99),(4,10,NULL)")
      await tx.$executeRawUnsafe("INSERT INTO squares VALUES (1,10,1,100),(2,10,1,200),(3,20,2,100),(4,10,2,100),(5,40,99,100)")
      await tx.$executeRawUnsafe("INSERT INTO circle_memberships VALUES (1,100,true)")
      await tx.$executeRawUnsafe("INSERT INTO round_participations VALUES (1,1,NULL,100,NULL),(2,1,99,100,NULL),(3,1,2,100,NULL),(4,2,1,100,NULL),(5,1,4,100,NULL),(6,1,3,100,NULL),(7,3,5,100,NULL),(8,4,1,100,55)")
      const before = await tx.$queryRawUnsafe("SELECT * FROM round_participations ORDER BY id")
      const groups = await tx.$queryRawUnsafe<Array<{ scope: string; participations: string; current_member: boolean; has_submitted_entry: boolean }>>(sql)
      expect(groups.map(group => group.scope).sort()).toEqual(["already_detached", "missing_square", "conflicting_user", "unresolved_round_room", "unresolved_square_room", "conflicting_room", "missing_room", "consistent"].sort())
      expect(groups.every(group => group.participations === "1" && !group.current_member)).toBe(true)
      expect(groups.find(group => group.scope === "consistent")?.has_submitted_entry).toBe(true)
      expect(await tx.$queryRawUnsafe("SELECT * FROM round_participations ORDER BY id")).toEqual(before)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
