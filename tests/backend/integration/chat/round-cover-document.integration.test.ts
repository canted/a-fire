import { readRoomCoverPreviews } from "@server/api/v1/rounds/room-cover-previews"
import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { ArtBeforeChorusRoundService } from "@server/api/v1/rounds/runtime/art-before-chorus.activity.service"

it("renders persisted document-only covers throughout the Round and treats the Document as authoritative", async () => {
  const prisma = new PrismaService(), now = new Date(), rollback = new Error("rollback cover fixture")
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@cover-document.test`, username: "Cover author", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Cover room", created_at: now, updated_at: now } })
      const round = await tx.round.create({ data: { room_id: room.id, host_id: user.id, name: "Cover round", template_key: "art_before_chorus", status: "archived", closed_at: now, created_at: now, updated_at: now } })
      await tx.activityParticipation.create({ data: { round_id: round.id, user_id: user.id, role: "participant", status: "active", joined_at: now, created_at: now, updated_at: now } })
      const base = { room_id: room.id, round_id: round.id, user_id: user.id, status: "published", format: "mixed_media", created_at: now, updated_at: now }
      const post = await tx.entry.create({ data: base })
      const document = await tx.document.create({ data: { docable_type: "Post", docable_id: post.id, content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/42" } }] }, created_at: now, updated_at: now } })
      const cover = await tx.activityArtifact.create({ data: { round_id: round.id, user_id: user.id, entry_id: post.id, kind: "cover", status: "active", submitted_at: now, created_at: now, updated_at: now } })
      const response = await tx.entry.create({ data: base })
      await tx.activityArtifact.create({ data: { round_id: round.id, user_id: user.id, entry_id: response.id, kind: "response", source_artifact_id: cover.id, status: "active", submitted_at: now, created_at: now, updated_at: now } })
      await tx.activityOffer.create({ data: { round_id: round.id, user_id: user.id, first_artifact_id: cover.id, second_artifact_id: cover.id, chosen_artifact_id: cover.id, created_at: now, updated_at: now } })
      const service = new ArtBeforeChorusRoundService(); Object.assign(service, { prisma: tx })
      const result = await service.detail(round, user.id, "member")
      const url = "/api/v1/uploads/42/variants/w1200"
      expect(result.viewer.cover?.imageUrl).toBe(url)
      expect(result.viewer.chosenCover?.imageUrl).toBe(url)
      expect(result.viewer.offeredCovers?.map(item => item.imageUrl)).toEqual([url, url])
      expect(result.participants[0].cover?.imageUrl).toBe(url)
      expect(result.results[0].cover.imageUrl).toBe(url)
      expect((await service.detail(round, user.id, "visitor")).results[0].cover.imageUrl).toBe(url)
      expect((await readRoomCoverPreviews(tx, room.id, user.id, [round.id])).get(round.id)?.imageUrl).toBe(url)
      const other = await tx.user.create({ data: { email: `${crypto.randomUUID()}@cover-document.test`, username: "Other", created_at: now, updated_at: now } })
      const chosenPost = await tx.entry.create({ data: { ...base, user_id: other.id, format_data: { image_url: "/chosen.png" } } })
      await tx.document.create({ data: { docable_type: "Post", docable_id: chosenPost.id, content: { type: "doc", content: [{ type: "image", attrs: { src: "/chosen.png" } }] }, created_at: now, updated_at: now } })
      const chosen = await tx.activityArtifact.create({ data: { round_id: round.id, user_id: other.id, entry_id: chosenPost.id, kind: "cover", status: "active", submitted_at: now, created_at: now, updated_at: now } })
      await tx.activityOffer.update({ where: { round_id_user_id: { round_id: round.id, user_id: user.id } }, data: { chosen_artifact_id: chosen.id } })
      let queryCount = 0
      const query: typeof tx.$queryRaw = (...args) => { queryCount += 1; return tx.$queryRaw(...args) }
      const previews = await readRoomCoverPreviews({ $queryRaw: query }, room.id, user.id, [round.id, round.id + 100000])
      expect(queryCount).toBe(1)
      expect(previews.get(round.id)?.imageUrl).toBe("/chosen.png")
      await tx.entry.update({ where: { id: chosenPost.id }, data: { round_id: null } })
      expect((await readRoomCoverPreviews(tx, room.id, user.id, [round.id])).get(round.id)?.imageUrl).toBe(url)
      expect((await readRoomCoverPreviews(tx, room.id + 100000, user.id, [round.id])).size).toBe(0)
      await tx.entry.update({ where: { id: post.id }, data: { status: "deleted" } })
      expect((await readRoomCoverPreviews(tx, room.id, user.id, [round.id])).size).toBe(0)
      await tx.entry.update({ where: { id: post.id }, data: { status: "published" } })
      // Retired image metadata cannot replace an empty authoritative Document.
      await tx.document.update({ where: { id: document.id }, data: { content: { type: "doc", content: [] } } })
      await tx.entry.update({ where: { id: post.id }, data: { format_data: { image_url: "/legacy-cover.png" } } })
      expect((await service.detail(round, user.id, "member")).viewer.cover?.imageUrl).toBe("")
      // Restoring the Document restores its cover image.
      await tx.document.update({ where: { id: document.id }, data: { content: document.content! } })
      expect((await service.detail(round, user.id, "member")).viewer.cover?.imageUrl).toBe(url)
      expect(await tx.entry.findUnique({ where: { id: post.id } })).toMatchObject({ format_data: { image_url: "/legacy-cover.png" } })
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
