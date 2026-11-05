import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { canReadRoundDraft } from "@server/api/v1/entries/entry-draft-access"

it("keeps Round draft exceptions inside current membership and consistent Room scope", async () => {
  const prisma = new PrismaService(), now = new Date(), rollback = new Error("rollback draft access fixture")
  try {
    await prisma.$transaction(async tx => {
      const database = tx as unknown as PrismaService
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@round-draft.test`, username: "Host", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Room", owner_id: user.id, porosity: "closed", created_at: now, updated_at: now } })
      const other = await tx.room.create({ data: { name: "Other Room", owner_id: user.id, porosity: "closed", created_at: now, updated_at: now } })
      const membership = await tx.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
      const round = await tx.round.create({ data: { room_id: room.id, host_id: user.id, template_key: "art_before_chorus", status: "active", name: "Round", submit_by: new Date(now.getTime() - 60000), created_at: now, updated_at: now } })
      const post = await tx.entry.create({ data: { room_id: room.id, round_id: round.id, user_id: user.id, status: "draft", created_at: now, updated_at: now } })
      const artifact = await tx.activityArtifact.create({ data: { round_id: round.id, entry_id: post.id, user_id: user.id, kind: "cover", status: "active", submitted_at: now, created_at: now, updated_at: now } })
      const access = new RoomAccessService(); Object.assign(access, { prisma: database })
      const read = () => canReadRoundDraft(database, access, post, user.id)
      expect(await read()).toBe(true)
      await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
      expect(await read()).toBe(false)
      await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: false } })
      await tx.round.update({ where: { id: round.id }, data: { status: "cancelled" } })
      expect(await read()).toBe(false)
      await tx.round.update({ where: { id: round.id }, data: { status: "active", room_id: other.id } })
      expect(await read()).toBe(false)
      await tx.round.update({ where: { id: round.id }, data: { room_id: room.id } })
      expect(await read()).toBe(true)
      expect(await canReadRoundDraft(database, access, { ...post, room_id: other.id }, user.id)).toBe(false)
      expect(await canReadRoundDraft(database, access, { ...post, round_id: round.id + 1 }, user.id)).toBe(false)
      await tx.room.update({ where: { id: room.id }, data: { deleted_at: now } })
      expect(await read()).toBe(false)
      expect(await tx.activityArtifact.findUniqueOrThrow({ where: { id: artifact.id } })).toEqual(artifact)
      expect(await tx.entry.findUniqueOrThrow({ where: { id: post.id } })).toEqual(post)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})

it("authorizes Room drafts through current participation without rewriting private sources", async () => {
  const { ArtBeforeChorusRoundService } = await import("@server/api/v1/rounds/runtime/art-before-chorus.activity.service")
  const prisma = new PrismaService(), now = new Date(), rollback = new Error("rollback participation fixture")
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@round-participation.test`, username: "Member", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Room", owner_id: user.id, porosity: "closed", created_at: now, updated_at: now } })
      const membership = await tx.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
      const round = await tx.round.create({ data: { room_id: room.id, host_id: user.id, template_key: "art_before_chorus", status: "active", name: "Round", submit_by: new Date(now.getTime() + 60000), created_at: now, updated_at: now } })
      const participation = await tx.activityParticipation.create({ data: { round_id: round.id, user_id: user.id, role: "participant", joined_at: now, created_at: now, updated_at: now } })
      const access = new RoomAccessService(); Object.assign(access, { prisma: tx })
      const service = new ArtBeforeChorusRoundService(); Object.assign(service, { prisma: tx, circleAccess: access })
      const validate = () => service.validateDraft(round, user.id, "round_activity_cover", tx)
      expect((await validate()).participation.id).toBe(participation.id)
      const project = await tx.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })
      const source = await tx.entry.create({ data: { project_id: project.id, user_id: user.id, status: "published", creation_origin: "project_material", created_at: now, updated_at: now } })
      const post = await tx.entry.create({ data: { source_entry_id: source.id, room_id: room.id, round_id: round.id, user_id: user.id, status: "draft", creation_origin: "round_activity_cover", format: "mixed_media", created_at: now, updated_at: now } })
      await tx.document.create({ data: { docable_type: "Post", docable_id: post.id, content: { type: "doc", content: [{ type: "image", attrs: { src: "https://example.test/cover.png" } }] }, created_at: now, updated_at: now } })
      // Reuse the enclosing rollback transaction for the real submission write path.
      const database = new Proxy(tx, { get(target, key) { return key === "$transaction" ? (write: (client: typeof tx) => unknown) => write(tx) : Reflect.get(target, key) } })
      Object.assign(service, { prisma: database })
      const otherRoom = await tx.room.create({ data: { name: "Other", created_at: now, updated_at: now } })
      await tx.entry.update({ where: { id: post.id }, data: { room_id: otherRoom.id } })
      await expect(service.submitArtifact(round, user.id, { kind: "cover", entryId: post.id })).rejects.toThrow("another Room")
      await tx.entry.update({ where: { id: post.id }, data: { room_id: room.id } })
      const submitted = await service.submitArtifact(round, user.id, { kind: "cover", entryId: post.id })
      expect(await tx.activityArtifact.findUniqueOrThrow({ where: { id: Number(submitted.id) } })).toMatchObject({ entry_id: post.id, round_id: round.id, user_id: user.id, status: "active" })
      expect(await tx.entry.findUniqueOrThrow({ where: { id: source.id } })).toEqual(source)

      await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
      await expect(validate()).rejects.toThrow()
      await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: false } })
      await tx.activityParticipation.update({ where: { id: participation.id }, data: { status: "withdrawn" } })
      await expect(validate()).rejects.toThrow("Join this Activity")
      await tx.activityParticipation.update({ where: { id: participation.id }, data: { status: "active" } })
      const { RoundsService } = await import("@server/api/v1/rounds/rounds.service")
      const standard = new RoundsService(); Object.assign(standard, { prisma: tx, circleAccess: access })
      await tx.round.update({ where: { id: round.id }, data: { template_key: "feedback" } })
      expect((await standard.validateActivitySubmission(round.id, user.id, undefined, tx))?.participation?.id).toBe(participation.id)
      expect(await tx.activityParticipation.findUniqueOrThrow({ where: { id: participation.id } })).toEqual(participation)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
