import { ReflectionsService } from "@server/api/v1/reflections/reflections.service"
import { PagesWriteService } from "@server/api/v1/pages/pages.write.service"
import "reflect-metadata"
import { it, expect, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossWorkers } from "@server/queue/boss.workers"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each([false, true])("preserves concurrent Note inserts and deduplicates jobs (mixed HTTP inserts: %s)", async mixed => {
  const prisma = new PrismaService()
  const now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@note-worker.test`, username: "Author", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Room", owner_id: user.id, created_at: now, updated_at: now } })
  const page = await prisma.page.create({ data: { title: "Note", room_id: room.id, created_at: now, updated_at: now } })
  await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
  const posts: number[] = []
  try {
    const jobs: number[] = []
    for (let index = 0; index < 3; index++) {
      const post = await prisma.entry.create({ data: { user_id: user.id, room_id: room.id, status: "published", created_at: now, updated_at: now, published_at: now } })
      posts.push(post.id)
      await prisma.document.create({ data: { docable_type: "Post", docable_id: post.id, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Source ${index}` }] }] }, created_at: now, updated_at: now } })
      const reflection = await prisma.reflection.create({ data: { page_id: page.id, user_id: user.id, reflectable_type: "Post", reflectable_id: post.id, created_at: now, updated_at: now } })
      jobs.push(reflection.id)
    }
    const worker = withTestDependencies(new BossWorkers(), { prisma })
    const pages = withTestDependencies(new PagesWriteService(), { prisma, realtime: { emit: vi.fn(), noteRoom: () => "note-room" } })
    if (mixed) await pages.prependContentBlocks(page.id, user.id, { blocks: [{ type: "audio", attrs: { audioAssetId: 901, nodeId: "anchor" } }] })
    await Promise.all([
      ...[...jobs, ...jobs].map(reflectionId => worker.handleReflectionApply({ reflectionId })),
      ...(mixed ? [pages.prependContentBlocks(page.id, user.id, { blocks: [{ type: "paragraph", content: [{ type: "text", text: "Top insertion" }] }] }),
      pages.prependContentBlocks(page.id, user.id, { position: "after_audio", audio_asset_id: 901, audio_node_id: "anchor", blocks: [{ type: "paragraph", content: [{ type: "text", text: "Audio insertion" }] }] })] : []),
    ])
    const documents = await prisma.document.findMany({ where: { docable_type: "Note", docable_id: page.id } })
    expect(documents).toHaveLength(1)
    const nodes = (documents[0].content as { content: Array<{ type: string; attrs?: { sourceId?: number } }> }).content
    expect(nodes.filter(node => node.type === "contentSource").map(node => node.attrs?.sourceId).sort()).toEqual([...posts].sort())
    for (let index = 0; index < 3; index++) expect(JSON.stringify(nodes).split(`Source ${index}`).length - 1).toBe(1)
    if (mixed) {
      expect(JSON.stringify(nodes).split("Top insertion").length - 1).toBe(1)
      expect(JSON.stringify(nodes).split("Audio insertion").length - 1).toBe(1)
      expect(nodes.findIndex(node => node.type === "audio") + 1).toBe(nodes.findIndex(node => JSON.stringify(node).includes("Audio insertion")))
    }
    expect(documents[0].version).toBe(mixed ? 6 : 3)
    const reflections = withTestDependencies(new ReflectionsService(), { prisma, realtime: { emit: vi.fn(), entryRoom: () => "post", boardRoom: () => "board" } })
    await reflections.deleteForPost(posts[0], user.id, page.id)
    await worker.handleReflectionApply({ reflectionId: jobs[0] })
    // Removing the saved association does not erase an already committed independent copy.
    expect(await prisma.document.findUniqueOrThrow({ where: { id: documents[0].id } })).toEqual(documents[0])
    let revoked = false
    const stale = prisma.$extends({ query: { page: { async findUnique({ args, query }) {
      const result = await query(args)
      if (!revoked && args.select?.room_id) {
        revoked = true
        await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: user.id }, data: { disabled: true, revoked_at: now } })
      }
      return result
    } } } })
    const staleWriter = withTestDependencies(new PagesWriteService(), { prisma: stale, realtime: { emit: vi.fn(), noteRoom: () => "note-room" } })
    await expect(staleWriter.prependContentBlocks(page.id, user.id, { blocks: [{ type: "paragraph", content: [{ type: "text", text: "Stale insertion" }] }] })).rejects.toThrow("Forbidden")
    expect(await prisma.document.findUniqueOrThrow({ where: { id: documents[0].id } })).toEqual(documents[0])
    await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: user.id }, data: { disabled: false, revoked_at: null } })
    await prisma.room.update({ where: { id: room.id }, data: { deleted_at: now } })
    await expect(worker.handleReflectionApply({ reflectionId: jobs[1] })).rejects.toThrow("Community not found")
    expect((await prisma.document.findUniqueOrThrow({ where: { id: documents[0].id } })).version).toBe(mixed ? 6 : 3)
  } finally {
    await prisma.reflection.deleteMany({ where: { page_id: page.id } })
    await prisma.document.deleteMany({ where: { OR: [{ docable_type: "Note", docable_id: page.id }, { docable_type: "Post", docable_id: { in: posts } }] } })
    await prisma.entry.deleteMany({ where: { id: { in: posts } } })
    await prisma.page.delete({ where: { id: page.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
