import "reflect-metadata"
import { Module } from "@nestjs/common"
import { NestFactory } from "@nestjs/core"
import type { Request, Response } from "express"
import { build } from "esbuild"
import { chromium, type Browser } from "@playwright/test"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { AuthService } from "@server/api/v1/auth/auth.service"
import { AuthGuard } from "@server/api/v1/auth/auth.guard"
import { NotificationActivityService } from "@server/notifications/notification-activity.service"
import { NotesController } from "@server/api/v2/notes/notes.controller"
import { PagesController } from "@server/api/v1/pages/pages.controller"
import { PagesService } from "@server/api/v1/pages/pages.service"
import { PagesWriteService } from "@server/api/v1/pages/pages.write.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

type Harness = {
  init(id: number, token: string): Promise<void>
  edit(text: string): void
  save(): Promise<void>
  refresh(): Promise<void>
  snapshot(): { content: unknown; dirty: boolean; status: string | null }
  unversioned(): Promise<void>
}

it("keeps a conflicting browser draft through refresh and retry against real Note HTTP persistence", async () => {
  const prisma = new PrismaService()
  const now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@note-browser.test`, username: "Editor", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Room", owner_id: user.id, created_at: now, updated_at: now } })
  await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
  const writes = withTestDependencies(new PagesWriteService(), { prisma, realtime: { emit: vi.fn(), noteRoom: () => "note" } })
  const reads = withTestDependencies(new PagesService(), { prisma })
  const auth = new AuthService()
  const created = await writes.createPage(user.id, { room_id: room.id, title: "Conflict" })
  const id = created.page.id
  @Module({
    controllers: [NotesController, PagesController],
    providers: [AuthGuard, { provide: AuthService, useValue: auth },
      { provide: NotificationActivityService, useValue: { recordActivity: async () => {} } },
      { provide: PagesWriteService, useValue: writes }, { provide: PagesService, useValue: reads }],
  })
  class BrowserNotesModule {}
  const app = await NestFactory.create(BrowserNotesModule, { logger: false })
  let browser: Browser | undefined
  try {
    const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
      import { SessionTransport } from './frontend/src/lib/api/transport';
      import { fetchNote, saveNoteContent } from './frontend/src/lib/api/notes';
      import { createContentDraft } from './frontend/src/lib/contentDraft';
      let client, id, draft;
      window.noteTest = {
        async init(noteId, token) {
          id = noteId;
          client = new SessionTransport(location.origin + '/api', { read: async () => ({ accessToken: token, refreshToken: 'unused' }), write: async () => {} });
          const note = await fetchNote(client, id);
          draft = createContentDraft({ initialContent: note.content, initialVersion: note.version, autosave: false,
            onSave: async (content, version) => (await saveNoteContent(client, id, content, version)).version });
        },
        edit(text) { draft.change({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }); },
        save() { return draft.saveNow(); },
        async refresh() { const note = await fetchNote(client, id); draft.seed(note.content, note.version); },
        snapshot() { return draft.snapshot(); },
        unversioned() { return client.put('/v1/pages/' + id + '/content', { content: draft.snapshot().content }); }
      };
    ` }, bundle: true, write: false, platform: "browser", format: "iife" })
    app.use((request: Request, response: Response, next: () => void) => {
      if (request.path === "/client.js") response.type("application/javascript").send(bundle.outputFiles[0].text)
      else if (request.path === "/fixture") response.type("html").send('<!doctype html><script src="/client.js"></script>')
      else next()
    })
    await app.listen(0, "127.0.0.1")
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    const tabs = await Promise.all([context.newPage(), context.newPage()])
    const token = auth.issueAccessToken(user.id)
    for (const tab of tabs) {
      await tab.goto(`${await app.getUrl()}/fixture`)
      await tab.evaluate(async ({ id, token }) => (window as unknown as { noteTest: Harness }).noteTest.init(id, token), { id, token })
    }
    await tabs[0].evaluate(() => (window as unknown as { noteTest: Harness }).noteTest.edit("First editor saved"))
    await tabs[1].evaluate(() => (window as unknown as { noteTest: Harness }).noteTest.edit("Second editor unsaved"))
    await tabs[0].evaluate(() => (window as unknown as { noteTest: Harness }).noteTest.save())
    await tabs[1].evaluate(() => (window as unknown as { noteTest: Harness }).noteTest.refresh())
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(tabs[1].evaluate(() => (window as unknown as { noteTest: Harness }).noteTest.save())).rejects.toThrow("changed elsewhere")
    }
    // Read serializable state rather than exporting the browser's controller functions.
    const snapshot = await tabs[1].evaluate(() => (window as unknown as { noteTest: Harness }).noteTest.snapshot())
    expect(snapshot.dirty).toBe(true)
    expect(snapshot.status).toContain("changed elsewhere")
    expect(JSON.stringify(snapshot.content)).toContain("Second editor unsaved")
    await expect(tabs[1].evaluate(() => (window as unknown as { noteTest: Harness }).noteTest.unversioned())).rejects.toThrow("expected_version")
    const stored = await prisma.document.findFirstOrThrow({ where: { docable_type: "Note", docable_id: id } })
    expect(JSON.stringify(stored.content)).toContain("First editor saved")
    expect(stored.version).toBe(2)
    await prisma.roomMembership.updateMany({ where: { room_id: room.id }, data: { disabled: true, revoked_at: now } })
    await expect(tabs[1].evaluate(() => (window as unknown as { noteTest: Harness }).noteTest.save())).rejects.toThrow("Forbidden")
    expect(await prisma.document.findFirstOrThrow({ where: { docable_type: "Note", docable_id: id } })).toEqual(stored)
  } finally {
    await browser?.close()
    await app.close()
    await prisma.document.deleteMany({ where: { docable_type: "Note", docable_id: id } })
    await prisma.page.delete({ where: { id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
}, 20000)
