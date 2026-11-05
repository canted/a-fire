import { readFile } from "node:fs/promises"
import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"

it("inventories retained notification scope and direct links without changing records", async () => {
  const prisma = new PrismaClient(), rollback = new Error("rollback notification inventory")
  const sql = await readFile("server/prisma/notification-structure-inventory.sql", "utf8")
  try {
    await prisma.$transaction(async tx => {
      for (const [table, columns] of [
        ["notification_events", "id integer, event_type text, circle_id integer, board_id integer, square_id integer, post_id integer, target_path text"],
        ["circles", "id integer"], ["boards", "id integer, circle_id integer"],
        ["squares", "id integer, circle_id integer, board_id integer"],
      ]) await tx.$executeRawUnsafe(`CREATE TEMP TABLE ${table} (${columns}) ON COMMIT DROP`)
      await tx.$executeRawUnsafe("INSERT INTO circles VALUES (1),(2)")
      await tx.$executeRawUnsafe("INSERT INTO boards VALUES (10,1),(20,2),(30,1)")
      await tx.$executeRawUnsafe("INSERT INTO squares VALUES (1,1,10),(2,2,20),(3,1,30)")
      await tx.$executeRawUnsafe(`INSERT INTO notification_events VALUES
        (1,'post_created',1,10,1,5,'/app/entries/5'),
        (2,'reply_created',1,10,1,5,'/app/posts/5'),
        (3,'round_started',1,10,NULL,NULL,'/app/board/10/activities/8'),
        (4,'legacy',1,NULL,1,NULL,'/app/square/1'),
        (5,'legacy',99,10,NULL,NULL,NULL),
        (6,'legacy',1,99,NULL,NULL,NULL),
        (7,'legacy',1,20,NULL,NULL,NULL),
        (8,'legacy',1,NULL,99,NULL,NULL),
        (9,'legacy',1,NULL,2,NULL,NULL),
        (10,'legacy',1,10,3,NULL,NULL),
        (11,'private arbitrary value',1,10,NULL,NULL,'/unknown'),
        (12,'post_created',1,NULL,NULL,5,'/app/entries/5')`)
      const before = await tx.$queryRawUnsafe("SELECT * FROM notification_events ORDER BY id")
      const groups = await tx.$queryRawUnsafe<Array<{ event_type: string; scope: string; target_kind: string; notifications: string }>>(sql)
      expect(groups).toHaveLength(11)
      expect(groups.every(group => group.notifications === "1")).toBe(true)
      expect(groups.filter(group => group.target_kind === "entry")).toHaveLength(2)
      expect(groups.find(group => group.event_type === "round_started")?.target_kind).toBe("board_round")
      expect(groups.find(group => group.event_type === "unclassified")?.target_kind).toBe("other")
      expect(new Set(groups.map(group => group.scope))).toEqual(new Set([
        "consistent", "missing_room", "missing_board", "conflicting_board_room",
        "missing_square", "conflicting_square_room", "conflicting_square_board",
      ]))
      expect(await tx.$queryRawUnsafe("SELECT * FROM notification_events ORDER BY id")).toEqual(before)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
