import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { ArtBeforeChorusRoundService } from "@server/api/v1/rounds/runtime/art-before-chorus.activity.service"

it.each(["explicit", "missing", "conflicting", "private", "draft"].flatMap(scope =>
  (["member", "visitor"] as const).map(accessKind => ({ scope, accessKind }))))("applies $scope Entry scope to $accessKind Round results", async ({ scope, accessKind }) => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@result-scope.test`, username: "Author", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Round Room", created_at: now, updated_at: now } })
  const other = await prisma.room.create({ data: { name: "Other Room", created_at: now, updated_at: now } })
  const round = await prisma.round.create({ data: { room_id: room.id, host_id: user.id, name: "Creative", template_key: "art_before_chorus", status: "archived", closed_at: now, created_at: now, updated_at: now } })
  const project = await prisma.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })
  const service = new ArtBeforeChorusRoundService(); Object.assign(service, { prisma })
  let read: ReturnType<typeof vi.spyOn> | undefined
  try {
    const coverPost = await prisma.entry.create({ data: { user_id: user.id, room_id: room.id, round_id: round.id, status: "published", created_at: now, updated_at: now } })
    const responsePost = await prisma.entry.create({ data: { project_id: scope === "private" ? project.id : null, user_id: user.id, room_id: ["missing", "private"].includes(scope) ? null : scope === "conflicting" ? other.id : room.id, round_id: round.id, status: scope === "draft" ? "draft" : "published", created_at: now, updated_at: now } })
    const cover = await prisma.activityArtifact.create({ data: { round_id: round.id, user_id: user.id, entry_id: coverPost.id, kind: "cover", status: "active", submitted_at: now, created_at: now, updated_at: now } })
    await prisma.activityArtifact.create({ data: { round_id: round.id, user_id: user.id, entry_id: responsePost.id, source_artifact_id: cover.id, kind: "response", status: "active", submitted_at: now, created_at: now, updated_at: now } })
    read = vi.spyOn(prisma.document, "findMany")
    const detail = await service.detail(round, user.id, accessKind)
    const visible = !["missing", "conflicting", "private"].includes(scope) && (accessKind === "member" || scope !== "draft")
    expect(detail.results).toHaveLength(visible ? 1 : 0)
    if (accessKind === "visitor") expect(detail.viewer).toEqual({})
    else if (!visible) expect(detail.viewer.response).toBeUndefined()
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ where: {
      docable_type: "Post", docable_id: { in: visible ? [coverPost.id, responsePost.id] : [coverPost.id] },
    } }))
  } finally {
    read?.mockRestore()
    await prisma.activityArtifact.deleteMany({ where: { round_id: round.id } })
    await prisma.entry.deleteMany({ where: { round_id: round.id } })
    await prisma.round.delete({ where: { id: round.id } })
    await prisma.room.deleteMany({ where: { id: { in: [room.id, other.id] } } })
    await prisma.project.delete({ where: { id: project.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
