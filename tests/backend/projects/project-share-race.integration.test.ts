import { RoundsService } from "@server/api/v1/rounds/rounds.service"
import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common"
import { PrismaService } from "@server/prisma/prisma.service"
import { ProjectEntriesService } from "@server/api/v1/projects/project-entries.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"

it.each(["revoked", "changed", "room removed", "room deleted", "round closed", "round withdrawn", "feedback withdrawn", "feedback parent withdrawn", "feedback copy withdrawn", "feedback chat expired"])("rejects a prepared share when its Project source is %s", async reason => {
  const prisma = new PrismaService(), now = new Date()
  const users = await Promise.all(["Owner", "Author"].map(username => prisma.user.create({ data: { email: `${crypto.randomUUID()}@share-race.test`, username, created_at: now, updated_at: now } })))
  const [owner, author] = users
  const project = await prisma.project.create({ data: { owner_id: owner.id, name: "Private", created_at: now, updated_at: now } })
  const participant = await prisma.projectParticipation.create({ data: { project_id: project.id, user_id: author.id, invited_by_id: owner.id, status: "accepted", invited_at: now, created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { owner_id: author.id, name: "Room", created_at: now, updated_at: now } })
  await prisma.roomMembership.create({ data: { room_id: room.id, user_id: author.id, disabled: false, created_at: now, updated_at: now } })
  const round = reason.startsWith("round") ? await prisma.round.create({ data: { room_id: room.id, host_id: author.id, name: "Round", status: "active", created_at: now, updated_at: now } }) : null
  if (round) await prisma.activityParticipation.create({ data: { round_id: round.id, user_id: author.id, role: "participant", status: "active", joined_at: now, created_at: now, updated_at: now } })
  const entry = await prisma.entry.create({ data: { project_id: project.id, user_id: author.id, creation_origin: "project_material", status: "published", project_intent: "Selected title", created_at: now, updated_at: now } })
  const feedbackParent = reason.startsWith("feedback") ? await prisma.entry.create({ data: { user_id: author.id, room_id: room.id, status: "published", created_at: now, updated_at: now } }) : null
  const message = reason === "feedback chat expired" ? await prisma.chatMessage.create({ data: { room_id: room.id, author_id: author.id, entry_id: feedbackParent!.id, status: "published", timeline_kind: "message", masked_alias: "author", body: "Attachment", content: { type: "doc", content: [{ type: "image", attrs: { src: "/fixture" } }] }, fire_at: now, expires_at: new Date(now.getTime() + 86400000), created_at: now, updated_at: now } }) : null
  if (message) await prisma.entry.update({ where: { id: feedbackParent!.id }, data: { creation_origin: "chat_attachment" } })
  const reply = feedbackParent ? await prisma.reply.create({ data: { entry_id: feedbackParent.id, user_id: owner.id, status: "published", created_at: now, updated_at: now } }) : null
  const saved = reply ? await prisma.entry.create({ data: { project_id: project.id, user_id: author.id, creation_origin: "project_feedback", status: "published", source_entry_id: entry.id, source_shared_entry_id: feedbackParent!.id, source_reply_id: reply.id, source_room_id: room.id, source_room_ids: [room.id], created_at: now, updated_at: now } }) : null
  if (saved) await prisma.document.create({ data: { docable_type: "Post", docable_id: saved.id, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Saved feedback" }] }] }, created_at: now, updated_at: now } })
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let reached!: () => void
  const ready = new Promise<void>(resolve => { reached = resolve })
  const scoped = prisma.$extends({ query: { room: { async findUnique({ args, query }) { const result = await query(args); reached(); await held; return result } } } })
  const circleAccess = new RoomAccessService()
  Object.assign(circleAccess, { prisma })
  const copyContentSnapshot = vi.fn()
  const activities = new RoundsService()
  Object.assign(activities, { prisma, circleAccess })
  const validate = activities.validateActivitySubmission.bind(activities)
  let firstValidation = true
  activities.validateActivitySubmission = async (...args) => {
    const result = await validate(...args)
    if (firstValidation) { firstValidation = false; reached(); await held }
    return result
  }
  const service = new ProjectEntriesService()
  Object.assign(service, { prisma: scoped, circleAccess, rounds: activities, uploads: { copyContentSnapshot } })
  let work: Promise<unknown> | undefined
  try {
    const manifest = saved ? await service.shareSelection(project.id, entry.id, author.id, room.id) : null
    work = service.shareDraft(project.id, entry.id, author.id, { room_id: room.id, round_id: round?.id, ...(saved ? { selected_unit_ids: [`feedback:${saved.id}`], source_revision: manifest!.revision } : {}), request_key: crypto.randomUUID() })
    const outcome = work.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }))
    await Promise.race([ready, outcome.then(result => { throw result.error ?? new Error("Share finished before test checkpoint") })])
    if (reason === "revoked") await prisma.projectParticipation.update({ where: { id: participant.id }, data: { status: "removed" } })
    else if (reason === "room removed") await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: author.id }, data: { disabled: true } })
    else if (reason === "room deleted") await prisma.room.update({ where: { id: room.id }, data: { deleted_at: new Date() } })
    else if (reason === "round closed") await prisma.round.update({ where: { id: round!.id }, data: { status: "archived" } })
    else if (reason === "round withdrawn") await prisma.activityParticipation.updateMany({ where: { round_id: round!.id, user_id: author.id }, data: { status: "withdrawn" } })
    else if (reason === "feedback withdrawn") await prisma.reply.update({ where: { id: reply!.id }, data: { status: "deleted" } })
    else if (reason === "feedback parent withdrawn") await prisma.entry.update({ where: { id: feedbackParent!.id }, data: { status: "deleted" } })
    else if (reason === "feedback copy withdrawn") await prisma.entry.update({ where: { id: saved!.id }, data: { status: "deleted" } })
    else if (reason === "feedback chat expired") await prisma.chatMessage.update({ where: { id: message!.id }, data: { expires_at: new Date(0) } })
    else await prisma.entry.update({ where: { id: entry.id }, data: { project_intent: "Changed title", updated_at: new Date(now.getTime() + 1000) } })
    release()
    expect((await outcome).error).toBeInstanceOf(reason === "round closed" ? BadRequestException : reason === "room deleted" ? NotFoundException : (reason === "changed" || reason === "feedback copy withdrawn") ? ConflictException : ForbiddenException)
    expect(copyContentSnapshot).not.toHaveBeenCalled()
    if (message) {
      const refreshed = await service.shareSelection(project.id, entry.id, author.id, room.id)
      expect(refreshed.units.find(unit => unit.id === `feedback:${saved!.id}`)?.eligible).toBe(false)
      expect(JSON.stringify((await prisma.document.findUniqueOrThrow({ where: { docable_type_docable_id: { docable_type: "Post", docable_id: saved!.id } } })).content)).toContain("Saved feedback")
    }
    expect(await prisma.entry.count({ where: { source_entry_id: entry.id, room_id: room.id } })).toBe(0)
  } finally {
    release()
    await work?.catch(() => {})
    if (message) await prisma.chatMessage.delete({ where: { id: message.id } })
    if (saved) await prisma.document.deleteMany({ where: { docable_type: "Post", docable_id: saved.id } })
    if (saved) await prisma.entry.delete({ where: { id: saved.id } })
    if (reply) await prisma.reply.delete({ where: { id: reply.id } })
    if (feedbackParent) await prisma.entry.delete({ where: { id: feedbackParent.id } })
    await prisma.entry.delete({ where: { id: entry.id } })
    if (round) await prisma.round.delete({ where: { id: round.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.project.delete({ where: { id: project.id } })
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } })
    await prisma.$disconnect()
  }
})
