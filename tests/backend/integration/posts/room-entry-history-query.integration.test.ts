import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { roomReplySummaries, entryReplyRoundSummaries } from "@server/api/v1/entries/room-reply-summary"
import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"
import { recentRoomMemberEntryIds } from "@server/api/v1/entries/room-entry-history"

it("bounds history independently per Room/member and uses the history index for the production SQL", async () => {
  const prisma = new PrismaClient({ log: [{ emit: "event", level: "query" }] })
  const captured: Array<{ query: string; params: string }> = []
  prisma.$on("query", event => { if (event.query.includes("CROSS JOIN LATERAL")) captured.push(event) })
  const now = new Date()
  const room = await prisma.room.create({ data: { name: "History scope", created_at: now, updated_at: now } })
  const otherRoom = await prisma.room.create({ data: { name: "Unrelated history", created_at: now, updated_at: now } })
  const users = await Promise.all([0, 1, 2, 3].map(index => prisma.user.create({ data: { email: `${crypto.randomUUID()}@bounded-history.test`, username: `Member ${index}`, created_at: now, updated_at: now } })))
  const projects = await Promise.all(users.map(user => prisma.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })))
  const sources = await Promise.all(users.map((user, index) => prisma.entry.create({ data: { user_id: user.id, project_id: projects[index].id, creation_origin: "project_material", status: "published", created_at: now, updated_at: now } })))
  try {
    for (const [index, user] of users.slice(0, 2).entries()) {
      const sourceId = sources[index].id
      await prisma.entry.createMany({ data: Array.from({ length: 10000 }, (_, index) => ({
        room_id: room.id, source_entry_id: sourceId, user_id: user.id, status: "published", created_at: new Date(now.getTime() - index * 1000), updated_at: now, published_at: new Date(now.getTime() - index * 1000),
      })) })
      await prisma.entry.createMany({ data: Array.from({ length: 10000 }, (_, offset) => ({
        room_id: otherRoom.id, source_entry_id: sourceId, user_id: user.id, status: "published", created_at: new Date(now.getTime() + offset + 1000), updated_at: now, published_at: new Date(now.getTime() + offset + 1000),
      })) })
      await prisma.entry.createMany({ data: ["draft", "deleted"].map(status => ({ room_id: room.id, source_entry_id: sourceId, user_id: user.id, status, created_at: new Date(now.getTime() + 1000), updated_at: now, published_at: new Date(now.getTime() + 1000) })) })
    }
    await prisma.entry.create({ data: { source_entry_id: sources[0].id, room_id: room.id, user_id: users[0].id, status: "published", published_at: new Date(now.getTime() + 500), created_at: now, updated_at: now } })
    await prisma.$executeRaw`ANALYZE entries`
    const expected = await Promise.all(users.slice(0, 2).map(user => prisma.entry.findMany({ where: { room_id: room.id, user_id: user.id, status: "published", source_entry_id: { not: null } }, orderBy: [{ published_at: "desc" }, { created_at: "desc" }, { id: "desc" }], take: 3, select: { id: true } })))
    const members = [...users, users[0]].map(user => ({ roomId: room.id, userId: user.id }))
    const recent = await recentRoomMemberEntryIds(prisma, members, 3)
    expect(recent).toEqual(expected.flat().map(post => post.id))
    expect(await recentRoomMemberEntryIds(prisma, members, 1)).toEqual(expected.map(posts => posts[0].id))
    expect(captured).toHaveLength(2)
    const access = new RoomAccessService()
    Object.assign(access, { prisma })
    for (const memberPosts of expected) {
      for (const [index, row] of memberPosts.entries()) {
        const post = await prisma.entry.findUniqueOrThrow({ where: { id: row.id } })
        expect(await access.isCurrentPublishedPost(post)).toBe(index === 0)
      }
    }
    // Permission checks must use the same bounded production SQL as Room home.
    expect(captured).toHaveLength(8)
    expect(captured.slice(2).every(statement => statement.query === captured[1].query)).toBe(true)
    const firstPost = expected[0][0].id, secondPost = expected[1][0].id
    for (const user of users) await prisma.reply.createMany({ data: Array.from({ length: 20 }, () => ({ entry_id: firstPost, user_id: user.id, status: "published", created_at: now, updated_at: now })) })
    await prisma.reply.createMany({ data: ["draft", "deleted"].map(status => ({ entry_id: firstPost, user_id: users[0].id, status, created_at: now, updated_at: now })) })
    const summaries = await roomReplySummaries(prisma, [firstPost, secondPost])
    expect(summaries).toEqual([
      { entry_id: firstPost, reply_count: 80n, participants: users.slice(0, 3).map(user => ({ id: user.id, username: user.username })) },
      { entry_id: secondPost, reply_count: 0n, participants: [] },
    ])
    expect(await roomReplySummaries(prisma, [])).toEqual([])
    // A later creation time must not override an earlier non-null publication time.
    await prisma.reply.createMany({ data: [
      { entry_id: firstPost, user_id: users[0].id, status: "published", created_at: new Date(now.getTime() + 9000), updated_at: now, published_at: new Date(now.getTime() - 1000) },
      { entry_id: firstPost, user_id: users[0].id, status: "published", created_at: new Date(now.getTime() + 1000), updated_at: now, published_at: null },
      { entry_id: firstPost, user_id: users[0].id, status: "draft", created_at: new Date(now.getTime() + 99000), updated_at: now },
    ] })
    expect(await entryReplyRoundSummaries(prisma, [firstPost, secondPost])).toEqual([
      { entry_id: firstPost, reply_count: 82n, latest_at: new Date(now.getTime() + 1000) },
    ])
    expect(await entryReplyRoundSummaries(prisma, [])).toEqual([])

    // Explain the exact parameterized production query captured above, not a test-only rewrite.
    const statement = captured[0]
    const plan = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`EXPLAIN (ANALYZE, FORMAT JSON) ${statement.query}`, ...JSON.parse(statement.params))
    expect(JSON.stringify(plan)).toContain("index_entries_on_room_member_history")
    const historyScans: Array<Record<string, unknown>> = []
    const visit = (node: Record<string, unknown>) => {
      if (node["Index Name"] === "index_entries_on_room_member_history") historyScans.push(node)
      for (const child of (node.Plans ?? []) as Array<Record<string, unknown>>) visit(child)
    }
    visit((plan[0]["QUERY PLAN"] as Array<{ Plan: Record<string, unknown> }>)[0].Plan)
    expect(historyScans.length).toBeGreaterThan(0)
    for (const scan of historyScans) expect(Number(scan["Actual Rows"])).toBeLessThanOrEqual(3)
  } finally {
    await prisma.reply.deleteMany({ where: { entry: { room_id: room.id } } })
    await prisma.entry.deleteMany({ where: { room_id: { in: [room.id, otherRoom.id] } } })
    await prisma.entry.deleteMany({ where: { id: { in: sources.map(source => source.id) } } })
    await prisma.project.deleteMany({ where: { id: { in: projects.map(project => project.id) } } })
    await prisma.room.deleteMany({ where: { id: { in: [room.id, otherRoom.id] } } })
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } })
    await prisma.$disconnect()
  }
}, 30000)
