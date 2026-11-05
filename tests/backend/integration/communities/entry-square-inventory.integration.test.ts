import { readFile } from "node:fs/promises"
import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"

it("distinguishes legacy Room provenance from private sources and conflicting ownership", async () => {
  const prisma = new PrismaClient(), rollback = new Error("rollback Entry inventory")
  const sql = await readFile("server/prisma/entry-square-inventory.sql", "utf8")
  try {
    await prisma.$transaction(async tx => {
      for (const [table, columns] of [
        ["posts", "id integer, square_id integer, user_id integer, circle_id integer, project_id integer, source_entry_id integer, creation_origin text, status text"],
        ["squares", "id integer, circle_id integer, user_id integer"], ["circles", "id integer"],
        ["circle_memberships", "circle_id integer, user_id integer, disabled boolean"],
        ["round_participations", "submitted_post_id integer"],
      ]) await tx.$executeRawUnsafe(`CREATE TEMP TABLE ${table} (${columns}) ON COMMIT DROP`)
      await tx.$executeRawUnsafe("INSERT INTO circles VALUES (1),(2)")
      await tx.$executeRawUnsafe("INSERT INTO squares VALUES (1,1,100),(2,1,200),(3,NULL,100),(4,99,100)")
      await tx.$executeRawUnsafe("INSERT INTO circle_memberships VALUES (1,100,false)")
      await tx.$executeRawUnsafe("INSERT INTO posts VALUES (1,1,100,NULL,NULL,NULL,NULL,'published'),(2,99,100,1,NULL,NULL,NULL,'draft'),(3,2,100,1,NULL,NULL,NULL,'published'),(4,3,100,NULL,NULL,NULL,NULL,'published'),(5,1,100,2,NULL,NULL,NULL,'published'),(6,4,100,99,NULL,NULL,NULL,'published'),(7,1,100,1,NULL,50,'chat_attachment','published'),(8,1,100,1,7,NULL,NULL,'deleted')")
      await tx.$executeRawUnsafe("INSERT INTO round_participations VALUES (1)")
      const before = await tx.$queryRawUnsafe("SELECT * FROM posts ORDER BY id")
      const groups = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)
      expect(groups).toHaveLength(8)
      expect(groups.filter(g => g.scope !== "consistent").map(g => g.scope).sort()).toEqual(["missing_square", "conflicting_user", "unscoped_square", "conflicting_room", "missing_room"].sort())
      expect(groups.find(g => g.submitted_to_round)).toMatchObject({ scope: "consistent", has_private_source: false, has_project: false, entries: "1" })
      expect(groups.find(g => g.chat_attachment)).toMatchObject({ has_private_source: true })
      expect(groups.find(g => g.has_project)).toMatchObject({ status: "deleted" })
      expect(await tx.$queryRawUnsafe("SELECT * FROM posts ORDER BY id")).toEqual(before)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
