import { createServer } from "node:http"
import { type Hocuspocus, type Document, OutgoingMessage } from "@hocuspocus/server"
import "reflect-metadata"
import { it, expect, vi } from "vitest"
import * as Y from "yjs"
import { TiptapTransformer } from "@hocuspocus/transformer"
import { PrismaService } from "@server/prisma/prisma.service"
import { PagesWriteService } from "@server/api/v1/pages/pages.write.service"
import { HocuspocusService, createYdocFromTiptapContent, encodeYdocState } from "@server/realtime/hocuspocus.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

type Store = { persistDocument(name: string, document: Y.Doc, context: { userId: number }): Promise<void> }
it("merges stale live snapshots with stored insertions and concurrent server saves", async () => {
  const prisma = new PrismaService()
  const now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@note-save.test`, username: "Editor", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Room", owner_id: user.id, created_at: now, updated_at: now } })
  const page = await prisma.page.create({ data: { title: "Note", room_id: room.id, created_at: now, updated_at: now } })
  await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
  const initial = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original" }] }] }
  const base = createYdocFromTiptapContent(initial)
  const first = new Y.Doc()
  const second = new Y.Doc()
  const documents = [base, first, second]
  try {
    const state = encodeYdocState(base)
    const record = await prisma.document.create({ data: { docable_type: "Note", docable_id: page.id, content: initial, ydoc_state: state, version: 1, created_at: now, updated_at: now } })
    Y.applyUpdate(first, state)
    Y.applyUpdate(second, state)
    const edit = (document: Y.Doc, text: string) => {
      const paragraph = document.getXmlFragment("default").get(0) as Y.XmlElement
      const node = paragraph.get(0) as Y.XmlText
      node.insert(node.length, text)
    }
    edit(first, " first edit")
    edit(second, " second edit")
    const pages = withTestDependencies(new PagesWriteService(), { prisma, realtime: { emit: vi.fn(), noteRoom: () => "note" } })
    await pages.prependContentBlocks(page.id, user.id, { blocks: [{ type: "paragraph", content: [{ type: "text", text: "Stored insertion" }] }] })
    const stores = [0, 1].map(() => withTestDependencies(new HocuspocusService(), { prisma }) as unknown as Store)
    await Promise.all([stores[0].persistDocument(`note:${page.id}`, first, { userId: user.id }), stores[1].persistDocument(`note:${page.id}`, second, { userId: user.id })])
    let saved = await prisma.document.findUniqueOrThrow({ where: { id: record.id } })
    for (const text of ["Original", "first edit", "second edit", "Stored insertion"]) expect(JSON.stringify(saved.content).split(text).length - 1).toBe(1)
    const restored = new Y.Doc()
    documents.push(restored)
    Y.applyUpdate(restored, saved.ydoc_state!)
    expect(TiptapTransformer.fromYdoc(restored, "default")).toEqual(saved.content)
    expect(saved.version).toBe(4)
    const replacement = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Whole document replacement" }] }] }
    await pages.saveContent(page.id, user.id, replacement, 4)
    // A delayed live save must merge the replacement's deletion history, not resurrect its old nodes.
    await stores[0].persistDocument(`note:${page.id}`, first, { userId: user.id })
    saved = await prisma.document.findUniqueOrThrow({ where: { id: record.id } })
    expect(saved.content).toEqual(replacement)
    const replaced = new Y.Doc()
    documents.push(replaced)
    Y.applyUpdate(replaced, saved.ydoc_state!)
    expect(TiptapTransformer.fromYdoc(replaced, "default")).toEqual(replacement)
    for (const invalid of [undefined, null, "4", -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(pages.saveContent(page.id, user.id, initial, invalid)).rejects.toThrow("expected_version")
    }
    await expect(pages.saveContent(page.id, user.id, initial, 4)).rejects.toThrow("changed elsewhere")
    expect(await prisma.document.findUniqueOrThrow({ where: { id: record.id } })).toEqual(saved)
    const competing = await Promise.allSettled([
      pages.saveContent(page.id, user.id, initial, saved.version),
      pages.saveContent(page.id, user.id, replacement, saved.version),
    ])
    expect(competing.filter(result => result.status === "fulfilled")).toHaveLength(1)
    expect(competing.filter(result => result.status === "rejected")).toHaveLength(1)
    const winner = competing.find(result => result.status === "fulfilled")!
    if (winner.status === "fulfilled") expect(winner.value.page.version).toBe(saved.version + 1)
    saved = await prisma.document.findUniqueOrThrow({ where: { id: record.id } })
    await prisma.roomMembership.updateMany({ where: { room_id: room.id }, data: { disabled: true, revoked_at: now } })
    await expect(stores[0].persistDocument(`note:${page.id}`, first, { userId: user.id })).rejects.toThrow("Forbidden")
    expect(await prisma.document.findUniqueOrThrow({ where: { id: record.id } })).toEqual(saved)
    await prisma.roomMembership.updateMany({ where: { room_id: room.id }, data: { disabled: false, revoked_at: null } })
    for (const legacyContent of [false, true]) {
      await prisma.document.deleteMany({ where: { docable_type: "Note", docable_id: page.id } })
      if (legacyContent) await prisma.document.create({ data: { docable_type: "Note", docable_id: page.id, content: initial, version: 1, created_at: now, updated_at: now } })
      const hosts = [0, 1].map(() => {
        const service = withTestDependencies(new HocuspocusService(), { prisma })
        const http = createServer()
        service.attach(http)
        return { http, service, server: (service as unknown as { server: Hocuspocus }).server }
      })
      try {
        const loaded = await Promise.all(hosts.map(host => host.server.hooks("onLoadDocument", { documentName: `note:${page.id}`, context: { userId: user.id } } as never))) as Y.Doc[]
        documents.push(...loaded)
        expect(Buffer.from(Y.encodeStateVector(loaded[0]))).toEqual(Buffer.from(Y.encodeStateVector(loaded[1])))
        expect(await prisma.document.count({ where: { docable_type: "Note", docable_id: page.id } })).toBe(1)
        if (!legacyContent) {
          let finishLoad!: (document: Document) => void
          const name = `note:${page.id}`
          hosts[0].server.loadingDocuments.set(name, new Promise(resolve => { finishLoad = resolve }))
          const inserting = hosts[0].service.prependPageContentBlocks(page.id, user.id, [{ type: "paragraph", content: [{ type: "text", text: "Inserted while loading" }] }])
          try {
            await vi.waitFor(async () => {
              const current = await prisma.document.findFirstOrThrow({ where: { docable_type: "Note", docable_id: page.id } })
              expect(JSON.stringify(current.content)).toContain("Inserted while loading")
            })
            expect(loaded[0].getXmlFragment("default").toString()).not.toContain("Inserted while loading")
            finishLoad(loaded[0] as Document)
            await inserting
            expect(loaded[0].getXmlFragment("default").toString()).toContain("Inserted while loading")
          } finally {
            finishLoad(loaded[0] as Document)
            await inserting
            hosts[0].server.loadingDocuments.delete(name)
          }
        }
        if (legacyContent) expect(TiptapTransformer.fromYdoc(loaded[0], "default")).toEqual(initial)
        if (legacyContent) {
          const editor = new Y.Doc()
          documents.push(editor)
          Y.applyUpdate(editor, Y.encodeStateAsUpdate(loaded[0]))
          let packet!: Uint8Array
          editor.on("update", (update: Uint8Array) => { packet = new OutgoingMessage(`note:${page.id}`).createSyncMessage().writeUpdate(update).toUint8Array() })
          const text = (editor.getXmlFragment("default").get(0) as Y.XmlElement).get(0) as Y.XmlText
          text.insert(text.length, " durable live edit")
          const payload = (document: Y.Doc) => ({ documentName: `note:${page.id}`, document, context: { userId: user.id }, connection: { readOnly: false }, update: packet })
          await hosts[0].server.hooks("beforeHandleMessage", payload(loaded[0]) as never)
          const accepted = await prisma.document.findFirstOrThrow({ where: { docable_type: "Note", docable_id: page.id } })
          expect(accepted.version).toBe(2)
          expect(JSON.stringify(accepted.content)).toContain("Original durable live edit")
          await expect(pages.saveContent(page.id, user.id, initial, 1)).rejects.toThrow("changed elsewhere")
          // A different process replaying the same packet must not invent a revision.
          await hosts[1].server.hooks("beforeHandleMessage", payload(loaded[1]) as never)
          expect(await prisma.document.findFirstOrThrow({ where: { docable_type: "Note", docable_id: page.id } })).toEqual(accepted)
          text.insert(text.length, " rejected write")
          const failure = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("Storage unavailable"))
          try {
            await expect(hosts[0].server.hooks("beforeHandleMessage", payload(loaded[0]) as never)).rejects.toThrow("Storage unavailable")
            expect(JSON.stringify(TiptapTransformer.fromYdoc(loaded[0], "default"))).not.toContain("rejected write")
            expect(await prisma.document.findFirstOrThrow({ where: { docable_type: "Note", docable_id: page.id } })).toEqual(accepted)
          } finally { failure.mockRestore() }
        }
      } finally { hosts.forEach(host => host.http.close()) }
    }

  } finally {
    documents.forEach(document => document.destroy())
    await prisma.document.deleteMany({ where: { docable_type: "Note", docable_id: page.id } })
    await prisma.page.delete({ where: { id: page.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
