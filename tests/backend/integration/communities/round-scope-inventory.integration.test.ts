import { readFile } from "node:fs/promises"
import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"

it("distinguishes retained Round ownership conflicts and linked content without choosing a Room", async () => {
  const prisma = new PrismaClient(), rollback = new Error("rollback Round inventory fixture")
  const sql = await readFile("server/prisma/round-scope-inventory.sql", "utf8")
  try {
    await prisma.$transaction(async tx => {
      for (const [table, columns] of [
        ["rounds", "id integer, board_id integer, circle_id integer, host_id integer, status text"],
        ["boards", "id integer, circle_id integer"], ["circles", "id integer"],
        ["circle_memberships", "circle_id integer, user_id integer, disabled boolean"],
        ["posts", "round_id integer"], ["round_participations", "round_id integer"], ["round_activity_artifacts", "round_id integer"],
      ]) await tx.$executeRawUnsafe(`CREATE TEMP TABLE ${table} (${columns}) ON COMMIT DROP`)
      await tx.$executeRawUnsafe("INSERT INTO circles VALUES (1),(2)")
      await tx.$executeRawUnsafe("INSERT INTO boards VALUES (10,1),(20,NULL),(30,2)")
      await tx.$executeRawUnsafe("INSERT INTO circle_memberships VALUES (1,100,false)")
      await tx.$executeRawUnsafe("INSERT INTO rounds VALUES (1,10,1,100,'active'),(2,20,1,100,''),(3,30,1,100,'archived'),(4,NULL,2,200,'draft')")
      await tx.$executeRawUnsafe("INSERT INTO posts VALUES (2)")
      const before = await tx.$queryRawUnsafe("SELECT * FROM rounds ORDER BY id")
      const groups = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)
      expect(groups).toHaveLength(4)
      expect(groups.find(group => group.scope === "conflicting" && group.status === "empty")).toMatchObject({ explicit_room_exists: true, board_room_exists: false, host_in_explicit_room: true, host_in_board_room: false, has_entries: true, has_participations: false, has_artifacts: false, rounds: "1" })
      expect(groups.find(group => group.scope === "conflicting" && group.status === "archived")).toMatchObject({ board_room_exists: true, has_entries: false })
      expect(groups.find(group => group.scope === "room_owned")).toMatchObject({ status: "draft", explicit_room_exists: true })
      expect(groups.find(group => group.scope === "consistent")).toMatchObject({ status: "active", host_in_board_room: true })
      expect(await tx.$queryRawUnsafe("SELECT * FROM rounds ORDER BY id")).toEqual(before)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
