import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"

it("uses Room and Entry physical names throughout the current database catalog", async () => {
  const database = new PrismaClient()
  try {
    const objects = await database.$queryRaw<Array<{ kind: string; name: string }>>`
      SELECT 'table' AS kind, table_name AS name FROM information_schema.tables WHERE table_schema = 'public'
      UNION ALL SELECT 'column', column_name FROM information_schema.columns WHERE table_schema = 'public'
      UNION ALL SELECT 'index', indexname FROM pg_indexes WHERE schemaname = 'public'
      UNION ALL SELECT 'constraint', conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace
    `
    expect(objects.filter(object => /(^|_)(circles?|community|communities|boards?|squares?|posts?)(_|$)/.test(object.name))).toEqual([])
    const tables = objects.filter(object => object.kind === "table").map(object => object.name)
    expect(tables).toEqual(expect.arrayContaining(["rooms", "room_memberships", "entries", "entry_subjects", "entry_view_states", "project_rooms"]))
    const parents = await database.$queryRaw<Array<{ target: string }>>`
      SELECT foreign_table.relname AS target FROM pg_constraint constraint_record
      JOIN pg_class foreign_table ON foreign_table.oid = constraint_record.confrelid
      JOIN pg_attribute column_record ON column_record.attrelid = constraint_record.conrelid
        AND column_record.attnum = ANY(constraint_record.conkey)
      WHERE constraint_record.conrelid = 'notes'::regclass AND constraint_record.contype = 'f'
        AND column_record.attname = 'parent_note_id'
    `
    expect(parents).toEqual([{ target: "notes" }])
  } finally {
    await database.$disconnect()
  }
})

it("exposes canonical Entry and Room API names from persistence records", async () => {
  const { EntriesReadService } = await import("@server/api/v1/entries/entries.read.service")
  const { RoomAccessService } = await import("@server/api/v1/rooms/room-access.service")
  const { withTestDependencies } = await import("@tests/backend/helpers/service")
  const database = new PrismaClient()
  const rollback = new Error("Rollback naming contract fixtures")
  try {
    await database.$transaction(async transaction => {
      const now = new Date()
      const user = await transaction.user.create({ data: { email: `${crypto.randomUUID()}@naming.test`, username: "Author", created_at: now, updated_at: now } })
      const room = await transaction.room.create({ data: { name: "Room", owner_id: user.id, created_at: now, updated_at: now } })
      await transaction.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
      const entry = await transaction.entry.create({ data: { room_id: room.id, user_id: user.id, status: "published", published_at: now, created_at: now, updated_at: now } })
      const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Entry body" }] }] }
      await transaction.document.create({ data: { docable_type: "Post", docable_id: entry.id, content, created_at: now, updated_at: now } })
      const circleAccess = withTestDependencies(new RoomAccessService(), { prisma: transaction })
      const reader = withTestDependencies(new EntriesReadService(), { prisma: transaction, circleAccess, linkPreviews: {
        serializeAttachment: async () => null,
        attachmentsForOwners: async () => new Map(),
      } })
      const response = await reader.fetchEntry(entry.id, user.id)
      expect(response.entry).toMatchObject({ id: entry.id, room_id: room.id, room: { id: room.id, name: "Room" }, content })
      expect(response.entry).not.toHaveProperty("community_id")
      expect(response).not.toHaveProperty("post")
      throw rollback
    }).catch(error => { if (error !== rollback) throw error })
  } finally {
    await database.$disconnect()
  }
})
