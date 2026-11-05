import "reflect-metadata"
import { createServer } from "node:http"
import { it, expect, vi } from "vitest"
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider"
import { Hocuspocus } from "@hocuspocus/server"
import WebSocket, { type WebSocketServer } from "ws"
import * as Y from "yjs"
import { PrismaService } from "@server/prisma/prisma.service"
import { HocuspocusService } from "@server/realtime/hocuspocus.service"
import { NoteChangeListener } from "@server/realtime/note-change-listener"
import { PagesWriteService } from "@server/api/v1/pages/pages.write.service"
import { AuthService } from "@server/api/v1/auth/auth.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each(["editor", "server", "audio"] as const)("stops %s Note updates to an idle revoked editor on the real WebSocket path", async source => {
  const prisma = new PrismaService()
  const now = new Date()
  const users = await Promise.all(["Owner", "Member"].map(username => prisma.user.create({ data: { email: `${crypto.randomUUID()}@note-wire.test`, username, created_at: now, updated_at: now } })))
  const room = await prisma.room.create({ data: { name: "Room", owner_id: users[0].id, created_at: now, updated_at: now } })
  const page = await prisma.page.create({ data: { title: "Note", room_id: room.id, created_at: now, updated_at: now } })
  await prisma.roomMembership.createMany({ data: users.map(user => ({ room_id: room.id, user_id: user.id, created_at: now, updated_at: now })) })
  const authService = new AuthService()
  const hosts = await Promise.all([0, 1].map(async () => {
    const service = withTestDependencies(new HocuspocusService(), { prisma, authService })
    const http = createServer()
    service.attach(http)
    const internal = service as unknown as { server: Hocuspocus; wsServer: WebSocketServer }
    await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve))
    return { service, http, internal, address: http.address() as { port: number } }
  }))
  const { service, internal } = hosts[0]
  const clients = users.map((user, index) => {
    const socket = new HocuspocusProviderWebsocket({ url: `ws://127.0.0.1:${hosts[index].address.port}/hocuspocus`, WebSocketPolyfill: WebSocket })
    const document = new Y.Doc()
    const provider = new HocuspocusProvider({ websocketProvider: socket, name: `note:${page.id}`, document, token: authService.issueAccessToken(user.id) })
    provider.attach()
    return { socket, document, provider }
  })
  try {
    await vi.waitFor(() => clients.forEach(client => expect(client.provider.isSynced).toBe(true)), { timeout: 5000 })
    if (source === "editor") {
      const writes = withTestDependencies(new PagesWriteService(), { prisma, realtime: { emit: vi.fn(), noteRoom: () => "note" } })
      const stored = await prisma.document.findFirstOrThrow({ where: { docable_type: "Note", docable_id: page.id } })
      await writes.saveContent(page.id, users[0].id, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "HTTP replacement" }] }] }, stored.version)
      await vi.waitFor(() => clients.forEach(client => expect(client.document.getXmlFragment("default").toString()).toContain("HTTP replacement")))
      await writes.prependContentBlocks(page.id, users[0].id, { blocks: [{ type: "paragraph", content: [{ type: "text", text: "Stored insertion" }] }] })
      await vi.waitFor(() => clients.forEach(client => expect(client.document.getXmlFragment("default").toString()).toContain("Stored insertion")))
      const listener = (hosts[1].service as unknown as { changeListener: NoteChangeListener }).changeListener
      await listener.stop()
      await writes.prependContentBlocks(page.id, users[0].id, { blocks: [{ type: "paragraph", content: [{ type: "text", text: "Missed while disconnected" }] }] })
      await vi.waitFor(() => expect(clients[0].document.getXmlFragment("default").toString()).toContain("Missed while disconnected"))
      expect(clients[1].document.getXmlFragment("default").toString()).not.toContain("Missed while disconnected")
      await listener.start()
      await vi.waitFor(() => expect(clients[1].document.getXmlFragment("default").toString()).toContain("Missed while disconnected"))
    }
    const insert = (text: string) => {
      const blocks = [{ type: "paragraph", content: [{ type: "text", text }] }]
      return source === "audio"
        ? service.insertPageContentBlocksAfterAudio(page.id, users[0].id, blocks, { audioAssetId: 41, audioNodeId: "anchor" })
        : service.prependPageContentBlocks(page.id, users[0].id, blocks)
    }
    if (source === "audio") await service.prependPageContentBlocks(page.id, users[0].id, [{ type: "audio", attrs: { audioAssetId: 41, nodeId: "anchor" } }])
    clients[0].document.getMap("access-probe").set("visible", "before revocation")
    await vi.waitFor(() => expect(clients[1].document.getMap("access-probe").get("visible")).toBe("before revocation"))
    {
      const lockClient = new PrismaService()
      let unlock!: () => void
      let locked!: () => void
      const held = new Promise<void>(resolve => { locked = resolve })
      const release = new Promise<void>(resolve => { unlock = resolve })
      const holding = lockClient.$transaction(async transaction => {
        await transaction.$queryRaw`SELECT id FROM notes WHERE id = ${page.id} FOR UPDATE`
        locked()
        await release
      }, { timeout: 10000 })
      const transactions = vi.spyOn(prisma, "$transaction")
      try {
        await held
        const calls = transactions.mock.calls.length
        const pending = source === "editor" ? Promise.resolve(clients[0].document.getMap("access-probe").set("durable", "committed before broadcast")) : insert("committed before broadcast")
        await vi.waitFor(() => expect(transactions.mock.calls.length).toBeGreaterThan(calls))
        expect(clients[1].document.getMap("access-probe").has("durable")).toBe(false)
        expect(clients[1].document.getXmlFragment("default").toString()).not.toContain("committed before broadcast")
        unlock()
        await holding
        await pending
        if (source === "editor") await vi.waitFor(() => expect(clients[1].document.getMap("access-probe").get("durable")).toBe("committed before broadcast"))
        else await vi.waitFor(() => expect(clients[1].document.getXmlFragment("default").toString()).toContain("committed before broadcast"))
        const stored = await prisma.document.findFirstOrThrow({ where: { docable_type: "Note", docable_id: page.id } })
        const restored = new Y.Doc()
        try {
          Y.applyUpdate(restored, stored.ydoc_state!)
          if (source === "editor") expect(restored.getMap("access-probe").get("durable")).toBe("committed before broadcast")
          else expect(restored.getXmlFragment("default").toString()).toContain("committed before broadcast")
        } finally { restored.destroy() }
      } finally {
        unlock()
        await holding
        transactions.mockRestore()
        await lockClient.$disconnect()
      }
    }
    if (source !== "editor") {
      const stored = await prisma.document.findFirstOrThrow({ where: { docable_type: "Note", docable_id: page.id } })
      const failure = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("Storage unavailable"))
      try {
        await expect(insert("must not be delivered")).rejects.toThrow("Storage unavailable")
        expect(internal.server.documents.get(`note:${page.id}`)!.getXmlFragment("default").toString()).not.toContain("must not be delivered")
        expect(await prisma.document.findFirstOrThrow({ where: { docable_type: "Note", docable_id: page.id } })).toEqual(stored)
      } finally { failure.mockRestore() }
    }
    // The second editor stays connected and sends no new edit after revocation.
    await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: users[1].id }, data: { disabled: true, revoked_at: now } })
    if (source === "editor") clients[0].document.getMap("access-probe").set("secret", "after revocation")
    else await insert("after revocation")
    await vi.waitFor(() => expect(hosts.reduce((sum, host) => sum + (host.internal.server.documents.get(`note:${page.id}`)?.getConnectionsCount() ?? 0), 0)).toBe(1), { timeout: 5000 })
    expect(clients[1].document.getMap("access-probe").has("secret")).toBe(false)
    expect(clients[1].document.getXmlFragment("default").toString()).not.toContain("after revocation")
    if (source === "editor") expect(clients[0].document.getMap("access-probe").get("secret")).toBe("after revocation")
    else await vi.waitFor(() => expect(clients[0].document.getXmlFragment("default").toString()).toContain("after revocation"))
    if (source === "editor") {
      const lockClient = new PrismaService()
      let unlock!: () => void
      let locked!: () => void
      const held = new Promise<void>(resolve => { locked = resolve })
      const release = new Promise<void>(resolve => { unlock = resolve })
      const holding = lockClient.$transaction(async transaction => {
        await transaction.$queryRaw`SELECT id FROM notes WHERE id = ${page.id} FOR UPDATE`
        locked()
        await release
      }, { timeout: 10000 })
      try {
        await held
        const inserting = insert("Completed during drain")
        let drained = false
        const closing = service.drain().then(() => { drained = true })
        expect(drained).toBe(false)
        unlock()
        await holding
        await Promise.all([inserting, closing])
        const saved = await prisma.document.findFirstOrThrow({ where: { docable_type: "Note", docable_id: page.id } })
        expect(JSON.stringify(saved.content)).toContain("Completed during drain")
        expect(internal.server.documents.size).toBe(0)
        await expect(internal.server.hooks("onAuthenticate", { documentName: `note:${page.id}`, token: authService.issueAccessToken(users[0].id) } as never)).rejects.toThrow("Server restarting")
      } finally { unlock(); await holding; await lockClient.$disconnect() }
    }
  } finally {
    clients.forEach(client => { client.provider.destroy(); client.socket.destroy(); client.document.destroy() })
    for (const host of hosts) {
      host.internal.server.closeConnections()
      for (const client of host.internal.wsServer.clients) client.terminate()
      await new Promise<void>(resolve => host.http.close(() => resolve()))
      await vi.waitFor(() => expect(host.internal.server.documents.size).toBe(0), { timeout: 5000 })
      host.internal.wsServer.close()
      await host.service.onModuleDestroy()
    }
    await prisma.document.deleteMany({ where: { docable_type: "Note", docable_id: page.id } })
    await prisma.page.delete({ where: { id: page.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } })
    await prisma.$disconnect()
  }
}, 15000)
