import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"

it("indexes recipient timeline and unread scans without changing retained rows", async () => {
  const prisma = new PrismaClient(), rollback = new Error("Rollback inbox index probe")

  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE inbox_index_probe (id integer PRIMARY KEY, user_id integer NOT NULL, notification_event_id integer NOT NULL, created_at timestamp NOT NULL, seen_at timestamp, UNIQUE(notification_event_id,user_id)) ON COMMIT DROP`)
      await tx.$executeRawUnsafe(`INSERT INTO inbox_index_probe SELECT n, n % 100, n, timestamp '2026-01-01' + n * interval '1 second', CASE WHEN n % 3 = 0 THEN timestamp '2026-01-02' END FROM generate_series(1,50000) n`)
      await tx.$executeRawUnsafe(`ANALYZE inbox_index_probe`)
      const queries = [
        `SELECT id FROM inbox_index_probe WHERE user_id=42 ORDER BY created_at DESC,id DESC LIMIT 51`,
        `SELECT id FROM inbox_index_probe WHERE user_id=42 AND seen_at IS NULL ORDER BY id ASC LIMIT 250`,
      ]
      const before = await Promise.all(queries.map(query => tx.$queryRawUnsafe<Array<{id: number}>>(query)))
      const plansBefore = await Promise.all(queries.map(query => tx.$queryRawUnsafe(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query}`)))
      const indexes = await tx.$queryRaw<Array<{ indexdef: string }>>`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='notification_inbox_items' AND indexname IN ('index_notification_inbox_items_on_user_created_id', 'index_notification_inbox_items_on_user_seen_id')`
      expect(indexes).toHaveLength(2)
      for (const { indexdef } of indexes) {
        await tx.$executeRawUnsafe(indexdef.replace('public.notification_inbox_items', 'inbox_index_probe'))
      }
      await tx.$executeRawUnsafe(`ANALYZE inbox_index_probe`)
      const plansAfter = []
      for (const [index, query] of queries.entries()) {
        expect(await tx.$queryRawUnsafe(query)).toEqual(before[index])
        plansAfter.push(await tx.$queryRawUnsafe(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query}`))
      }
      expect(JSON.stringify(plansAfter[0])).toContain("index_notification_inbox_items_on_user_created_id")
      expect(JSON.stringify(plansAfter[1])).toContain("index_notification_inbox_items_on_user_seen_id")
      expect(await tx.$queryRawUnsafe(`SELECT count(*)::integer AS count FROM inbox_index_probe`)).toEqual([{count:50000}])
      const installed = await tx.$queryRaw<Array<{indexname:string}>>`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='notification_inbox_items'`
      expect(installed.map(row => row.indexname)).toEqual(expect.arrayContaining(["index_notification_inbox_items_on_user_created_id", "index_notification_inbox_items_on_user_seen_id"]))
      // Compare optimizer work estimates, not noisy wall-clock test timing.
      const cost = (plan: unknown) => (plan as Array<{ "QUERY PLAN": Array<{ Plan: { "Total Cost": number } }> }>)[0]["QUERY PLAN"][0].Plan["Total Cost"]
      for (let index = 0; index < queries.length; index++) expect(cost(plansAfter[index])).toBeLessThan(cost(plansBefore[index]))
      throw rollback
    }, { timeout: 20000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
}, 25000)
