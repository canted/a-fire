import "reflect-metadata"
import { Client } from "pg"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { NoteChangeListener } from "@server/realtime/note-change-listener"
import { CommittedIdChangeListener } from "@server/realtime/committed-id-change-listener"
import { withNoteDocumentTransaction } from "@server/api/v1/pages/note-document-transaction"

it("delivers committed Note invalidations, suppresses rollback signals, and resyncs after disconnect", async () => {
  const prisma = new PrismaService()
  const now = new Date()
  const note = await prisma.page.create({ data: { title: "Notification fixture", created_at: now, updated_at: now } })
  const changed = vi.fn()
  const resync = vi.fn()
  const warn = vi.fn()
  const listener = new NoteChangeListener(process.env.DATABASE_URL!, changed, resync, warn)
  try {
    await listener.start()
    expect(resync).toHaveBeenCalledOnce()
    await withNoteDocumentTransaction(prisma, note.id, async transaction => {
      await transaction.page.update({ where: { id: note.id }, data: { title: "Committed" } })
    })
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(note.id))
    changed.mockClear()
    await expect(prisma.$transaction(async transaction => {
      await transaction.$queryRaw`SELECT pg_notify('afire_note_changes', ${String(note.id)})::text`
      throw new Error("Rollback")
    })).rejects.toThrow("Rollback")
    // A later committed sentinel establishes delivery order without a timing sleep.
    await prisma.$queryRaw`SELECT pg_notify('afire_note_changes', ${String(note.id + 1)})::text`
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(note.id + 1))
    expect(changed).not.toHaveBeenCalledWith(note.id)
    const client = (listener as unknown as { client: Client }).client
    const pid = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid
    await prisma.$queryRaw`SELECT pg_terminate_backend(${pid}::integer)`
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(resync).toHaveBeenCalledTimes(2), { timeout: 5000 })
    changed.mockClear()
    await withNoteDocumentTransaction(prisma, note.id, async () => {})
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(note.id))
    // Explicit disconnection also misses signals; restart must always request a full refresh.
    await listener.stop()
    await withNoteDocumentTransaction(prisma, note.id, async transaction => {
      await transaction.page.update({ where: { id: note.id }, data: { title: "Changed while disconnected" } })
    })
    await listener.start()
    expect(resync).toHaveBeenCalledTimes(3)
    expect((await prisma.page.findUniqueOrThrow({ where: { id: note.id } })).title).toBe("Changed while disconnected")
  } finally {
    await listener.stop()
    await prisma.page.delete({ where: { id: note.id } })
    await prisma.$disconnect()
  }
}, 10000)

it("isolates Room invalidations from Notes and recovers the Room subscription", async () => {
  const prisma = new PrismaService(), changed = vi.fn(), resync = vi.fn(), warn = vi.fn()
  const listener = new CommittedIdChangeListener("afire_room_changes", "afire-room-listener-test", process.env.DATABASE_URL!, changed, resync, warn)
  try {
    await listener.start()
    await prisma.$queryRaw`SELECT pg_notify('afire_note_changes', '801')::text`
    await prisma.$queryRaw`SELECT pg_notify('afire_room_changes', '802')::text`
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(802))
    expect(changed).not.toHaveBeenCalledWith(801)
    await expect(prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_notify('afire_room_changes', '803')::text`
      throw new Error("Rollback Room signal")
    })).rejects.toThrow("Rollback Room signal")
    await prisma.$queryRaw`SELECT pg_notify('afire_room_changes', '804')::text`
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(804))
    expect(changed).not.toHaveBeenCalledWith(803)
    const client = (listener as unknown as { client: Client }).client
    const pid = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid
    await prisma.$queryRaw`SELECT pg_terminate_backend(${pid}::integer)`
    await vi.waitFor(() => expect(resync).toHaveBeenCalledTimes(2), { timeout: 5000 })
    await prisma.$queryRaw`SELECT pg_notify('afire_room_changes', '805')::text`
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(805))
  } finally { await listener.stop(); await prisma.$disconnect() }
}, 10000)
