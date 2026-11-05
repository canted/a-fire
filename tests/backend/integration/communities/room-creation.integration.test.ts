import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { RoomsService } from "@server/api/v1/rooms/rooms.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each(["membership", "none"])("preserves Room creation guarantees with %s failure", async failure => {
  const prisma = new PrismaService()
  const now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@room-creation.test`, username: "Creator", created_at: now, updated_at: now } })
  const uploads = { createAttachmentUpload: vi.fn() }
  const fail = () => { throw new Error("injected creation failure") }
  const failing = failure === "membership"
    ? prisma.$extends({ query: { roomMembership: { create: fail } } })
    : prisma
  const access = withTestDependencies(new RoomAccessService(), { prisma: failing })
  const service = withTestDependencies(new RoomsService(), { prisma: failing, uploadsService: uploads, circleAccess: access })
  try {
    if (failure === "membership") {
      await expect(service.createRoom(user.id, { name: "Atomic Room", avatarFile: {} as Express.Multer.File })).rejects.toThrow("injected creation failure")
    } else {
      const created = await service.createRoom(user.id, { name: "Board-free Room" })
      expect(created).toMatchObject({ name: "Board-free Room" })
      await expect(service.updateRoom(created.id, user.id, { name: "Renamed Room" })).resolves.toMatchObject({ id: created.id, name: "Renamed Room" })
      await expect(service.fetchRoom(created.id, user.id)).resolves.toMatchObject({ id: created.id })
    }
    const expectedCount = failure === "membership" ? 0 : 1
    expect(await prisma.room.count({ where: { owner_id: user.id } })).toBe(expectedCount)
    expect(await prisma.roomMembership.count({ where: { user_id: user.id, disabled: false } })).toBe(expectedCount)
    expect(uploads.createAttachmentUpload).not.toHaveBeenCalled()
  } finally {
    const rooms = await prisma.room.findMany({ where: { owner_id: user.id }, select: { id: true } })
    const roomIds = rooms.map(room => room.id)
    await prisma.roomMembership.deleteMany({ where: { user_id: user.id } })
    await prisma.room.deleteMany({ where: { id: { in: roomIds } } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
