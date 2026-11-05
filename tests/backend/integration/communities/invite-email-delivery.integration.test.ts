import "reflect-metadata"
import { it, expect, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"
import { InvitesService } from "@server/api/v1/invites/invites.service"
import { InviteEmailProcessor, type InviteEmailJob } from "@server/mailer/invite-email.processor"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("queues resends without credentials and revalidates invitations before delivery", async () => {
  const prisma = new PrismaService()
  const boss = new BossService()
  await boss.start()
  const now = new Date()
  const owner = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@mail-owner.test`, username: "Owner", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { owner_id: owner.id, name: "Room", created_at: now, updated_at: now } })
  const invite = await prisma.invite.create({ data: { email: `${crypto.randomUUID()}@mail-recipient.test`, token: crypto.randomUUID(), invite_type: 0, room_id: room.id, invited_by_id: owner.id, expires_at: new Date(now.getTime() + 86400000), created_at: now, updated_at: now } })
  const mailer = { sendInviteEmail: vi.fn() }
  const processor = withTestDependencies(new InviteEmailProcessor(), { prisma, mailer })
  const service = withTestDependencies(new InvitesService(), { prisma, boss, mailer })
  const ids: string[] = []
  const persist = boss.enqueueInTransaction.bind(boss)
  let fail = true
  const enqueue = vi.spyOn(boss, "enqueueInTransaction").mockImplementation(async (...args) => {
    const id = await persist(...args)
    ids.push(id)
    if (fail) throw new Error("queue failure")
    return id
  })
  try {
    await prisma.roomMembership.create({ data: { room_id: room.id, user_id: owner.id, created_at: now, updated_at: now } })
    const newEmail = `${crypto.randomUUID()}@new-delivery.test`
    const payload = { email: newEmail, room_id: room.id }
    await expect(service.createInvite(owner.id, payload)).rejects.toThrow("queue failure")
    expect(await prisma.invite.count({ where: { email: newEmail } })).toBe(0)
    expect(await prisma.$queryRaw`SELECT id FROM pgboss.job WHERE id = ${ids.at(-1)!}::uuid`).toEqual([])
    fail = false
    const created = await Promise.all(Array.from({ length: 3 }, () => service.createInvite(owner.id, payload)))
    expect(new Set(created.map(value => value.id)).size).toBe(1)
    expect(await prisma.invite.count({ where: { email: newEmail } })).toBe(1)
    const original = await prisma.invite.findUniqueOrThrow({ where: { id: created[0].id } })
    await prisma.invite.update({ where: { id: original.id }, data: { expires_at: new Date(0) } })
    fail = true
    await expect(service.createInvite(owner.id, payload)).rejects.toThrow("queue failure")
    expect(await prisma.invite.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({ token: original.token, expires_at: new Date(0) })
    expect(await prisma.$queryRaw`SELECT id FROM pgboss.job WHERE id = ${ids.at(-1)!}::uuid`).toEqual([])
    fail = false
    await service.createInvite(owner.id, payload)
    const reissued = await prisma.invite.findUniqueOrThrow({ where: { id: original.id } })
    expect(reissued.token).not.toBe(original.token)
    expect(reissued.expires_at.getTime()).toBeGreaterThan(Date.now())
    fail = true
    await expect(service.resendInvite(owner.id, invite.id)).rejects.toThrow("queue failure")
    expect(await prisma.$queryRaw`SELECT id FROM pgboss.job WHERE id = ${ids[0]}::uuid`).toEqual([])
    fail = false
    await service.resendInvite(owner.id, invite.id)
    expect(mailer.sendInviteEmail).not.toHaveBeenCalled()
    const [job] = await prisma.$queryRaw<Array<{ data: InviteEmailJob }>>`SELECT data FROM pgboss.job WHERE id = ${ids.at(-1)!}::uuid`
    expect(JSON.stringify(job.data)).not.toContain(invite.token)
    expect(JSON.stringify(job.data)).not.toContain(invite.email)
    mailer.sendInviteEmail.mockRejectedValueOnce(new Error("SMTP unavailable"))
    await expect(processor.process(job.data)).rejects.toThrow("SMTP unavailable")
    await processor.process(job.data)
    expect(mailer.sendInviteEmail).toHaveBeenLastCalledWith(invite.email, invite.token, "Room")
    mailer.sendInviteEmail.mockClear()
    for (const change of [{ used_at: now }, { used_at: null, expires_at: new Date(0) }, { expires_at: invite.expires_at, token: "reissued" }]) {
      await prisma.invite.update({ where: { id: invite.id }, data: change })
      await processor.process(job.data)
    }
    await prisma.invite.update({ where: { id: invite.id }, data: { token: invite.token } })
    for (const action of ["expireInvite", "resendInvite"] as const) {
      let revoked = false
      const stale = prisma.$extends({ query: { invite: { async findFirst({ args, query }) {
        const result = await query(args)
        if (!revoked && args.where?.id === invite.id) {
          revoked = true
          await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: owner.id }, data: { disabled: true, revoked_at: now } })
        }
        return result
      } } } })
      const staleService = withTestDependencies(new InvitesService(), { prisma: stale, boss })
      const before = await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })
      const jobsBefore = ids.length
      await expect(staleService[action](owner.id, invite.id)).rejects.toThrow("Forbidden")
      expect(await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).toEqual(before)
      expect(ids).toHaveLength(jobsBefore)
      await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: owner.id }, data: { disabled: false, revoked_at: null } })
    }
    await service.expireInvite(owner.id, invite.id)
    const expired = await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(expired.expires_at.getTime()).toBeLessThanOrEqual(Date.now())
    await service.expireInvite(owner.id, invite.id)
    expect((await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).expires_at).toEqual(expired.expires_at)
    await processor.process(job.data)
    expect(mailer.sendInviteEmail).not.toHaveBeenCalled()
    await prisma.invite.update({ where: { id: invite.id }, data: { expires_at: invite.expires_at } })
    await prisma.room.update({ where: { id: room.id }, data: { deleted_at: now } })
    await processor.process(job.data)
    expect(mailer.sendInviteEmail).not.toHaveBeenCalled()
  } finally {
    enqueue.mockRestore()
    for (const id of ids) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE id = ${id}::uuid`
    await prisma.invite.deleteMany({ where: { room_id: room.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: owner.id } })
    await boss.onModuleDestroy()
    await prisma.$disconnect()
  }
})
