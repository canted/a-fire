import "reflect-metadata"
import { createServer } from "node:http"
import { it, expect } from "vitest"
import { Hocuspocus, OutgoingMessage } from "@hocuspocus/server"
import { PrismaService } from "@server/prisma/prisma.service"
import { HocuspocusService } from "@server/realtime/hocuspocus.service"
import { AuthService } from "@server/api/v1/auth/auth.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("rechecks live Note message access after membership revocation and Room deletion", async () => {
  const prisma = new PrismaService()
  const now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@note-access.test`, username: "Member", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Room", owner_id: user.id, created_at: now, updated_at: now } })
  const page = await prisma.page.create({ data: { title: "Note", room_id: room.id, created_at: now, updated_at: now } })
  const membership = await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
  const authService = new AuthService()
  const service = withTestDependencies(new HocuspocusService(), { prisma, authService })
  const http = createServer()
  service.attach(http)
  const server = (service as unknown as { server: Hocuspocus }).server
  const payload = { documentName: `note:${page.id}`, context: { userId: user.id }, update: new OutgoingMessage(`note:${page.id}`).writeQueryAwareness().toUint8Array() }
  try {
    // Exercise the real registered hooks and persistence; no mocked access resolver.
    await expect(server.hooks("onAuthenticate", { documentName: payload.documentName, token: authService.issueAccessToken(user.id) } as never)).resolves.toBeDefined()
    await server.hooks("beforeHandleMessage", payload as never)
    await prisma.roomMembership.update({ where: { id: membership.id }, data: { disabled: true, revoked_at: now } })
    await expect(server.hooks("beforeHandleMessage", payload as never)).rejects.toThrow("Forbidden")
    await prisma.roomMembership.update({ where: { id: membership.id }, data: { disabled: false, revoked_at: null } })
    await server.hooks("beforeHandleMessage", payload as never)
    await prisma.room.update({ where: { id: room.id }, data: { deleted_at: now } })
    await expect(server.hooks("beforeHandleMessage", payload as never)).rejects.toThrow("Forbidden")
    await expect(server.hooks("onLoadDocument", payload as never)).rejects.toThrow("Community not found")
    await prisma.room.update({ where: { id: room.id }, data: { deleted_at: null } })
    await prisma.page.update({ where: { id: page.id }, data: { deleted_at: now } })
    await expect(server.hooks("beforeHandleMessage", payload as never)).rejects.toThrow("Not Found")
    expect(await prisma.document.count({ where: { docable_type: "Note", docable_id: page.id } })).toBe(0)
  } finally {
    server.closeConnections()
    http.close()
    await prisma.page.delete({ where: { id: page.id } })
    await prisma.roomMembership.delete({ where: { id: membership.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
