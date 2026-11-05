import { Prisma } from "@prisma/client"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { selectCoverPair } from "@server/api/v1/rounds/cover-assignment"

it("selects only two eligible covers with the existing balance and score, including large IDs", async () => {
  const prisma = new PrismaService(), now = new Date(), rollback = Error("rollback assignment fixture")
  try {
    await prisma.$transaction(async tx => {
      const prefix = crypto.randomUUID()
      const users = await tx.user.createManyAndReturn({ data: Array.from({ length: 4096 }, (_, i) => ({ email: `${prefix}-${i}@cover-assignment.test`, username: `Artist ${i}`, created_at: now, updated_at: now })) })
      const room = await tx.room.create({ data: { name: "Assignments", owner_id: users[0].id, created_at: now, updated_at: now } })
      const round = await tx.round.create({ data: { room_id: room.id, host_id: users[0].id, template_key: "art_before_chorus", name: "Round", status: "active", created_at: now, updated_at: now } })
      const posts = await tx.entry.createManyAndReturn({ data: users.map(user => ({ user_id: user.id, room_id: room.id, round_id: round.id, status: "draft", created_at: now, updated_at: now })) })
      const covers = await tx.activityArtifact.createManyAndReturn({ data: posts.map((post, i) => ({ id: 2_100_000_000 + i, round_id: round.id, user_id: post.user_id!, entry_id: post.id, kind: "cover", status: i === 1 ? "removed" : "active", submitted_at: now, created_at: now, updated_at: now })) })
      const offers = users.slice(1).map((user, i) => ({ round_id: round.id, user_id: user.id, first_artifact_id: covers[i % 40].id, second_artifact_id: covers[(i + 1) % 40].id, created_at: now, updated_at: now }))
      await tx.activityOffer.createMany({ data: offers })
      const counts = new Map<number, number>()
      for (const offer of offers) for (const id of [offer.first_artifact_id, offer.second_artifact_id]) counts.set(id, (counts.get(id) ?? 0) + 1)
      const score = (userId: number, id: number) => {
        let value = (round.id * 73_856_093) ^ (userId * 19_349_663) ^ (id * 83_492_791)
        value ^= value >>> 16
        return value >>> 0
      }
      for (const user of users.slice(0, 8)) {
        const expected = covers.filter(cover => cover.status === "active" && cover.user_id !== user.id)
          .sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) || score(user.id, a.id) - score(user.id, b.id) || a.id - b.id)
          .slice(0, 2).map(({ id }) => ({ id }))
        expect(await selectCoverPair(tx, round.id, user.id)).toEqual(expected)
      }
      // Explain the actual production template, not a separately copied SQL query.
      const explain = { $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) =>
        tx.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${Prisma.sql(strings, ...values)}`) }
      const explained = await selectCoverPair(explain as unknown as Pick<typeof tx, "$queryRaw">, round.id, users[0].id)
      const report = (explained as unknown as Array<{ "QUERY PLAN": Array<Record<string, any>> }>)[0]["QUERY PLAN"][0]
      expect(report.Plan["Actual Rows"]).toBe(2)
      const nodes: Array<Record<string, any>> = []
      const visit = (node: Record<string, any>) => { nodes.push(node); for (const child of node.Plans ?? []) visit(child) }
      visit(report.Plan)
      expect(nodes.some(node => node["Sort Method"] === "top-N heapsort")).toBe(true)
      expect(nodes.some(node => (node["Temp Written Blocks"] ?? 0) > 0)).toBe(false)
      process.stdout.write(JSON.stringify({ coverAssignmentPlan: {
        covers: covers.length, offers: offers.length, returned: report.Plan["Actual Rows"],
        executionMs: report["Execution Time"], planningMs: report["Planning Time"],
        sharedHitBlocks: report.Plan["Shared Hit Blocks"], sharedReadBlocks: report.Plan["Shared Read Blocks"],
        sort: nodes.filter(node => node["Sort Method"]).map(node => ({ method: node["Sort Method"], memoryKB: node["Sort Space Used"] })),
        indexes: [...new Set(nodes.map(node => node["Index Name"]).filter(Boolean))],
      } }) + "\n")
      await tx.activityArtifact.updateMany({ where: { round_id: round.id, id: { not: covers[0].id } }, data: { status: "removed" } })
      expect(await selectCoverPair(tx, round.id, users[0].id)).toEqual([])
      expect(await selectCoverPair(tx, round.id, users[1].id)).toEqual([{ id: covers[0].id }])
      expect(await tx.activityOffer.count({ where: { round_id: round.id } })).toBe(4095)
      throw rollback
    }, { timeout: 30000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
