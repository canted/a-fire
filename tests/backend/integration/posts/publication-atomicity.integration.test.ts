import { recentRoomMemberEntryIds } from "@server/api/v1/entries/room-entry-history"
import { CommittedIdChangeListener } from "@server/realtime/committed-id-change-listener"
import "reflect-metadata"
import { RoundsService } from "@server/api/v1/rounds/rounds.service"
import { expect, it, vi } from "vitest"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { BossService } from "@server/queue/boss.service"
import { PrismaService } from "@server/prisma/prisma.service"
import { EntriesService } from "@server/api/v1/entries/entries.service"
import { EntryNotificationsService } from "@server/api/v1/entries/entry-notifications.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each([
  { failurePoint: "publication", origin: null },
  { failurePoint: "queue", origin: null },
] as const)("rolls back $origin publication after a $failurePoint failure, then serializes concurrent retries", async ({ failurePoint, origin }) => {
  const prisma = new PrismaService()
  const boss = new BossService()
  await boss.start()
  const now = new Date()
  const hints: number[] = []
  const listener = new CommittedIdChangeListener("afire_room_changes", "afire-publication-test", process.env.DATABASE_URL!, id => hints.push(id), () => {}, () => {})
  await listener.start()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@publication.test`, username: "Publisher", created_at: now, updated_at: now } })
  const postIds: number[] = []
  const insertedJobIds: string[] = []
  let roomId: number | undefined
  let projectId: number | undefined
  try {
    const room = await prisma.room.create({ data: { owner_id: user.id, name: "Publication", created_at: now, updated_at: now } })
    roomId = room.id
    await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
    const project = await prisma.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })
    projectId = project.id
    const source = await prisma.entry.create({ data: { user_id: user.id, project_id: project.id, creation_origin: "project_material", status: "published", published_at: now, created_at: now, updated_at: now } })
    postIds.push(source.id)
    const draft = await prisma.entry.create({ data: { user_id: user.id, source_entry_id: source.id, room_id: room.id, feedback_request_customized: true, creation_origin: origin, created_at: now, updated_at: now } })
    postIds.push(draft.id)
    // A delayed publication must not replace an already newer eligible share.
    const newerAt = new Date(now.getTime() + 60_000)
    const newer = await prisma.entry.create({ data: { user_id: user.id, source_entry_id: source.id, room_id: room.id, status: "published", published_at: newerAt, created_at: newerAt, updated_at: newerAt } })
    postIds.push(newer.id)
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "A complete thought" }] }, { type: "paragraph", content: [] }] }
    const document = await prisma.document.create({ data: { docable_type: "Post", docable_id: draft.id, content, version: 1, created_at: now, updated_at: now } })
    let fail = true
    let concurrent = false
    let arrivals = 0
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const database = prisma.$extends({ query: {
      entry: { async findUnique({ args, query }) {
        const result = await query(args)
        if (concurrent && args.where.id === draft.id && arrivals < 2) {
          if (++arrivals === 2) release()
          await barrier
        }
        return result
      }, async update({ args, query }) {
        const result = await query(args)
        if (fail && failurePoint === "publication" && args.data.status === "published") throw new Error("Publication interrupted")
        return result
      } } } })
    const persistJob = boss.enqueueInTransaction.bind(boss)
    const enqueue = vi.spyOn(boss, "enqueueInTransaction")
    enqueue.mockImplementation(async (...args) => {
      const result = await persistJob(...args)
      insertedJobIds.push(result)
      if (fail && failurePoint === "queue") throw new Error("Publication interrupted")
      return result
    })
    const emit = vi.fn()
    const service = withTestDependencies(new EntriesService(), {
      prisma: database,
      activitiesService: withTestDependencies(new RoundsService(), { prisma: database, circleAccess: withTestDependencies(new RoomAccessService(), { prisma: database }) }),
      circleAccess: withTestDependencies(new RoomAccessService(), { prisma: database }),
      notifications: withTestDependencies(new EntryNotificationsService(), { prisma: database, boss }),
      realtime: { emit, chatRoom: () => "chat-test" },
      read: { draftPayload: async () => ({ id: draft.id }) },
    })

    const forged = { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { targetType: "note", targetId: "2147483647", label: "Unavailable" } }] }] }
    await prisma.document.update({ where: { id: document.id }, data: { content: forged } })
    await expect(service.publish(draft.id, user.id)).rejects.toThrow("Mention unavailable")
    expect((await prisma.entry.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("draft")
    expect(await prisma.notificationEvent.count({ where: { entry_id: draft.id } })).toBe(0)
    expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).content).toEqual(forged)
    await prisma.document.update({ where: { id: document.id }, data: { content } })

    const sharedFeedback = [{ source_room_id: room.id, original_room_ids: [room.id], content: forged, format: "mixed_media", format_data: null }]
    await prisma.entry.update({ where: { id: draft.id }, data: { shared_feedback: sharedFeedback } })
    await expect(service.publish(draft.id, user.id)).rejects.toThrow("Mention unavailable")
    expect((await prisma.entry.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("draft")
    expect((await prisma.entry.findUniqueOrThrow({ where: { id: draft.id } })).shared_feedback).toEqual(sharedFeedback)
    expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).content).toEqual(content)
    expect(await prisma.notificationEvent.count({ where: { entry_id: draft.id } })).toBe(0)
    await prisma.entry.update({ where: { id: draft.id }, data: { shared_feedback: [] } })

    const round = await prisma.round.create({ data: { room_id: room.id, host_id: user.id, name: "Publication round", status: "active", submit_by: new Date(now.getTime() + 3600000), created_at: now, updated_at: now } })
    try {
      const participant = await prisma.activityParticipation.create({ data: { round_id: round.id, user_id: user.id, role: "participant", status: "active", joined_at: now, created_at: now, updated_at: now } })
      await prisma.entry.update({ where: { id: draft.id }, data: { round_id: round.id } })
      for (const change of ["withdrawal", "closed", "deadline"]) {
        const transact = database.$transaction.bind(database)
        const transactionSpy = vi.spyOn(database, "$transaction").mockImplementationOnce(async (callback: any) => {
          if (change === "withdrawal") await prisma.activityParticipation.update({ where: { id: participant.id }, data: { status: "withdrawn" } })
          if (change === "closed") await prisma.round.update({ where: { id: round.id }, data: { status: "archived" } })
          if (change === "deadline") await prisma.round.update({ where: { id: round.id }, data: { submit_by: new Date(Date.now() - 1) } })
          return transact(callback)
        })
        try {
          await expect(service.publish(draft.id, user.id)).rejects.toThrow(change === "withdrawal" ? "Join this activity" : change === "closed" ? "not accepting submissions" : "submissions are closed")
          expect(transactionSpy).toHaveBeenCalledOnce()
          expect((await prisma.entry.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("draft")
          expect(enqueue).not.toHaveBeenCalled()
          expect(emit).not.toHaveBeenCalled()
        } finally {
          transactionSpy.mockRestore()
          await prisma.activityParticipation.update({ where: { id: participant.id }, data: { status: "active" } })
          await prisma.round.update({ where: { id: round.id }, data: { status: "active", submit_by: round.submit_by } })
        }
      }
    } finally {
      await prisma.entry.update({ where: { id: draft.id }, data: { round_id: null } })
      await prisma.activityParticipation.deleteMany({ where: { round_id: round.id } })
      await prisma.round.delete({ where: { id: round.id } })
    }
    for (const change of ["revision", "document", "membership", "room"]) {
      const transact = database.$transaction.bind(database)
      const transactionSpy = vi.spyOn(database, "$transaction").mockImplementationOnce(async (callback: any) => {
        if (change === "revision") await prisma.entry.update({ where: { id: draft.id }, data: { updated_at: new Date(now.getTime() + 1) } })
        if (change === "document") await prisma.document.update({ where: { id: document.id }, data: { content: { type: "doc", content: [] } } })
        if (change === "membership") await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: user.id }, data: { disabled: true } })
        if (change === "room") await prisma.room.update({ where: { id: room.id }, data: { deleted_at: now } })
        return transact(callback)
      })
      try {
        await expect(service.publish(draft.id, user.id)).rejects.toThrow(change === "membership" ? "Members only" : change === "room" ? "Community not found" : "This Entry changed before publication")
        expect(transactionSpy).toHaveBeenCalledOnce()
        expect((await prisma.entry.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("draft")
        expect(enqueue).not.toHaveBeenCalled()
        expect(emit).not.toHaveBeenCalled()
      } finally {
        transactionSpy.mockRestore()
        await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: user.id }, data: { disabled: false } })
        await prisma.room.update({ where: { id: room.id }, data: { deleted_at: null } })
        await prisma.entry.update({ where: { id: draft.id }, data: { updated_at: now } })
        await prisma.document.update({ where: { id: document.id }, data: { content } })
      }
    }
    const validFeedback = [{ ...sharedFeedback[0], content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { targetType: "user", targetId: String(user.id), label: "Publisher", href: "/app/note/2147483647", avatarUrl: "/private-image" } }] }] } }]
    await prisma.entry.update({ where: { id: draft.id }, data: { shared_feedback: validFeedback } })
    await expect(service.publish(draft.id, user.id)).rejects.toThrow("Publication interrupted")
    expect((await prisma.entry.findUniqueOrThrow({ where: { id: draft.id } })).shared_feedback).toEqual(validFeedback)
    expect(await prisma.entry.findUnique({ where: { id: draft.id } })).toMatchObject({ status: "draft", published_at: null })
    expect((await recentRoomMemberEntryIds(prisma, [{ roomId: room.id, userId: user.id }], 1))[0] ?? null).toBe(newer.id)
    expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).content).toEqual(content)
    expect(await prisma.entrySubject.count({ where: { entry_id: draft.id } })).toBe(0)
    expect(await prisma.notificationEvent.count({ where: { entry_id: draft.id } })).toBe(0)
    for (const id of insertedJobIds) {
      expect(await prisma.$queryRaw`SELECT id FROM pgboss.job WHERE id = ${id}::uuid`).toEqual([])
    }
    expect(emit).not.toHaveBeenCalled()

    const sentinel = Number.MAX_SAFE_INTEGER - room.id
    await prisma.$queryRaw`SELECT pg_notify('afire_room_changes', ${String(sentinel)})::text`
    await vi.waitFor(() => expect(hints).toContain(sentinel))
    expect(hints).not.toContain(room.id)

    fail = false
    enqueue.mockClear()
    concurrent = true
    await Promise.all([service.publish(draft.id, user.id), service.publish(draft.id, user.id)])
    concurrent = false
    // A completed publication remains idempotent on later retries.
    await service.publish(draft.id, user.id)
    await prisma.$queryRaw`SELECT pg_notify('afire_room_changes', ${String(sentinel - 1)})::text`
    await vi.waitFor(() => expect(hints).toContain(sentinel - 1))
    expect(hints.filter(id => id === room.id)).toEqual([room.id])
    expect(await prisma.entry.findUnique({ where: { id: draft.id } })).toMatchObject({ status: "published", published_at: expect.any(Date) })
    expect((await recentRoomMemberEntryIds(prisma, [{ roomId: room.id, userId: user.id }], 1))[0] ?? null).toBe(newer.id)
    expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).content).toEqual({ ...content, content: content.content.slice(0, 1) })
    expect((await prisma.entry.findUniqueOrThrow({ where: { id: draft.id } })).shared_feedback).toEqual([{ ...validFeedback[0], content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { targetType: "user", targetId: String(user.id), label: "Publisher", id: `user:${user.id}`, href: `/app/rooms/${room.id}/members/${user.id}`, avatarUrl: null } }] }] } }])
    expect(await prisma.entrySubject.count({ where: { entry_id: draft.id } })).toBe(1)
    expect(await prisma.notificationEvent.count({ where: { entry_id: draft.id } })).toBe(1)
    expect(enqueue).toHaveBeenCalledTimes(1)
    const [event] = await prisma.notificationEvent.findMany({ where: { entry_id: draft.id } })
    expect(await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM pgboss.job WHERE name = 'notifications.fanout' AND data->>'eventId' = ${String(event.id)}
    `).toEqual([{ count: 1n }])
    // Concurrent and later retries do not repeat delivery or refresh work.
    expect(emit).toHaveBeenCalledWith("ChatChannel", "chat-test", { type: "invalidate", room_id: room.id })
    expect(emit).toHaveBeenCalledTimes(1)

  } finally {
    await listener.stop()
    await boss.onModuleDestroy()
    for (const id of insertedJobIds) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE id = ${id}::uuid`
    await prisma.chatMessage.deleteMany({ where: { entry_id: { in: postIds } } })
    const events = await prisma.notificationEvent.findMany({ where: { entry_id: { in: postIds } } })
    for (const event of events) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name = 'notifications.fanout' AND data->>'eventId' = ${String(event.id)}`
    await prisma.notificationEvent.deleteMany({ where: { entry_id: { in: postIds } } })
    await prisma.document.deleteMany({ where: { docable_type: "Post", docable_id: { in: postIds } } })
    await prisma.entrySubject.deleteMany({ where: { entry_id: { in: postIds } } })
    await prisma.entry.deleteMany({ where: { id: { in: postIds } } })
    if (projectId) await prisma.project.delete({ where: { id: projectId } })
    if (roomId) await prisma.roomMembership.deleteMany({ where: { room_id: roomId } })
    if (roomId) await prisma.room.delete({ where: { id: roomId } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
}, 15000)
