import { BadRequestException, ForbiddenException } from "@nestjs/common"
import { EntriesReadService } from "@server/api/v1/entries/entries.read.service"
import { EntriesService } from "@server/api/v1/entries/entries.service"
import { withTestDependencies } from "@tests/backend/helpers/service"
import { describe, expect, it, vi } from "vitest"

const { projectCandidate } = vi.hoisted(() => ({ projectCandidate: vi.fn() }))
vi.mock("@server/api/v1/entries/project-navigation-candidate", () => ({ projectNavigationCandidate: projectCandidate }))

const privateEntry = {
  id: 12, user_id: 2, project_id: 8, room_id: null,
  creation_origin: "project_material", status: "draft",
}

function readService() {
  projectCandidate.mockReset().mockResolvedValue(null)
  const post = {
    id: 30, user_id: 2, status: "published", room_id: 4,
    user: { id: 2, username: "Author" },
    created_at: new Date("2026-10-01T10:00:00Z"), published_at: new Date("2026-10-01T10:00:00Z"),
    format: "mixed_media", project_id: null, project: null, source_entry_id: 12,
  }
  const prisma = {
    room: { findUnique: vi.fn().mockResolvedValue({ id: 4, name: "Room" }) },
    entry: { findUnique: vi.fn().mockImplementation((args) => Promise.resolve(args?.where?.id === 12 ? { ...privateEntry, status: "published", project: { id: 8, name: "Private practice" } } : post)), findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    project: { findUnique: vi.fn().mockResolvedValue({ owner_id: 1, participations: [] }) },
    document: { findFirst: vi.fn().mockResolvedValue({ content: { type: "doc", content: [] } }) },
    activeStorageAttachment: { findFirst: vi.fn().mockResolvedValue(null) },
    reflection: { findMany: vi.fn().mockResolvedValue([]) },
    reply: { findMany: vi.fn().mockResolvedValue([]) },
    roomMembership: { findMany: vi.fn().mockResolvedValue([]) },
    chatMessage: { findUnique: vi.fn().mockResolvedValue(null) },
  }
  return withTestDependencies(new EntriesReadService(), {
    prisma,
    circleAccess: { require: vi.fn().mockResolvedValue({ kind: "member" }), resolve: vi.fn().mockResolvedValue({ kind: "member" }), canReadPublishedPostWithRoomHistory: vi.fn().mockResolvedValue(false) },
    linkPreviews: { serializeAttachment: vi.fn().mockResolvedValue(null), attachmentsForOwners: vi.fn().mockResolvedValue(new Map()) },
  })
}

describe("private project post access", () => {
  it.each(["draft", "published"])("rejects private %s entries from circle post detail before loading content", async (status) => {
    const service = readService()
    service.prisma.entry.findUnique.mockResolvedValue({ ...privateEntry, status })
    await expect(service.fetchEntry(12, 2)).rejects.toBeInstanceOf(ForbiddenException)
    expect(service.prisma.document.findFirst).not.toHaveBeenCalled()
    expect(service.circleAccess.require).not.toHaveBeenCalled()
  })

  it.each(["draft", "published"])("cannot publish private %s entries through the circle publish path", async (status) => {
    const service = withTestDependencies(new EntriesService(), {
      prisma: { entry: { findUnique: vi.fn().mockResolvedValue({ ...privateEntry, status }), update: vi.fn() } },
      realtime: { emit: vi.fn() }, notifications: { publish: vi.fn() },
    })
    await expect(service.publish(12, 2)).rejects.toBeInstanceOf(BadRequestException)
    expect(service.prisma.entry.update).not.toHaveBeenCalled()
    expect(service.realtime.emit).not.toHaveBeenCalled()
    expect(service.notifications.publish).not.toHaveBeenCalled()
  })

  it("does not let generic post mutations remove project access or add activity context", async () => {
    const service = withTestDependencies(new EntriesService(), {
      prisma: { entry: { findUnique: vi.fn().mockResolvedValue(privateEntry), update: vi.fn() } },
    })
    await expect(service.updateProject(12, 2, null)).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.updateDraftActivity(12, 2, 4)).rejects.toBeInstanceOf(BadRequestException)
    expect(service.prisma.entry.update).not.toHaveBeenCalled()
  })

  it("hides source Project metadata and adjacency from a circle-only viewer", async () => {
    const service = readService()
    const result = await service.fetchEntry(30, 9)
    expect(result.entry).toMatchObject({ project_id: null, project: null, previous_project_entry: null, next_project_entry: null })
    expect(service.prisma.entry.findFirst).toHaveBeenCalledTimes(2)
    expect(service.prisma.activeStorageAttachment.findFirst).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ record_type: "Project" }),
    }))
  })

  it("retains source Project metadata and scopes shared-copy adjacency to the project for an accepted member", async () => {
    const service = readService()
    service.prisma.project.findUnique.mockResolvedValue({ owner_id: 1, participations: [{ id: 7 }] })
    const result = await service.fetchEntry(30, 9)
    expect(result.entry.project).toMatchObject({ id: 8, name: "Private practice" })
    expect(projectCandidate).toHaveBeenCalledWith(service.prisma, 8, 30, expect.any(Date), true, undefined, 4)
    expect(service.prisma.entry.findMany).not.toHaveBeenCalled()
  })

  it.each([false, true])("exposes Keep and source identifiers only to an author who remains a project participant (member=%s)", async (member) => {
    const service = readService()
    const circlePost = await service.prisma.entry.findUnique()
    service.prisma.entry.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve(
      where.id === 12 ? { ...privateEntry, status: "published" } : { ...circlePost, project: null, project_id: null, source_entry_id: 12 },
    ))
    service.prisma.project.findUnique.mockResolvedValue({ owner_id: 1, participations: member ? [{ id: 7 }] : [] })
    const result = await service.fetchEntry(30, 2)
    expect(result.entry.project).toBeNull()
    expect(result.entry.project_id).toBe(member ? 8 : null)
    if (member) expect(result.entry).toMatchObject({ keep_project_id: 8, source_entry_id: 12 })
    else {
      expect(result.entry).not.toHaveProperty("keep_project_id")
      expect(result.entry).not.toHaveProperty("source_entry_id")
    }
  })

  it("never exposes private source identifiers before circle access succeeds", async () => {
    const service = readService()
    service.circleAccess.require.mockRejectedValue(new ForbiddenException("Forbidden"))
    await expect(service.fetchEntry(30, 9)).rejects.toBeInstanceOf(ForbiddenException)
    expect(service.prisma.project.findUnique).not.toHaveBeenCalled()
    expect(service.prisma.entry.findUnique).toHaveBeenCalledTimes(1)
  })

  it("hides Keep for deleted source material while the independent circle copy remains readable", async () => {
    const service = readService()
    const circlePost = await service.prisma.entry.findUnique()
    service.prisma.entry.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve(
      where.id === 12 ? { ...privateEntry, status: "deleted" } : { ...circlePost, project: null, project_id: null, source_entry_id: 12 },
    ))
    service.prisma.project.findUnique.mockResolvedValue({ owner_id: 1, participations: [{ id: 7 }] })
    const result = await service.fetchEntry(30, 9)
    expect(result.entry.id).toBe(30)
    expect(result.entry).not.toHaveProperty("keep_project_id")
    expect(result.entry).not.toHaveProperty("source_entry_id")
  })

  it.each(["project_material", "project_feedback"])("rejects private %s draft payloads for another member before loading content", async (creationOrigin) => {
    const service = readService()
    service.prisma.entry.findUnique.mockResolvedValue({ ...privateEntry, creation_origin: creationOrigin })
    service.prisma.project.findUnique.mockResolvedValue({ owner_id: 1, participations: [{ id: 7 }] })
    await expect(service.draftPayload(12, 9)).rejects.toBeInstanceOf(ForbiddenException)
    expect(service.prisma.document.findFirst).not.toHaveBeenCalled()
  })

  it.each([false, true])("resolves a shared copy's source project identity only for project participants (member=%s)", async (member) => {
    const service = readService()
    const circlePost = await service.prisma.entry.findUnique()
    service.prisma.entry.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve(
      where.id === 12
        ? { ...privateEntry, status: "published", project: { id: 8, name: "Private practice" } }
        : { ...circlePost, project: null, project_id: null, source_entry_id: 12 },
    ))
    service.prisma.project.findUnique.mockResolvedValue({ owner_id: 1, participations: member ? [{ id: 7 }] : [] })
    const result = await service.fetchEntry(30, 9)
    expect(result.entry.project).toEqual(member ? { id: 8, name: "Private practice", icon_url: null } : null)
    expect(result.entry.project_id).toBe(member ? 8 : null)
    if (!member) {
      expect(service.prisma.entry.findMany).not.toHaveBeenCalled()
      expect(result.entry.previous_project_entry).toBeNull()
      expect(result.entry.next_project_entry).toBeNull()
    }
  })

  it("finds author shares within this room while skipping other rooms and private candidates", async () => {
    const service = readService()
    service.circleAccess.resolve.mockImplementation((targetRoomId: number) => Promise.resolve(targetRoomId === 4 ? { kind: "member" } : null))
    service.prisma.entry.findFirst.mockImplementation(({ orderBy, cursor }) => {
      if (orderBy[0].published_at === "asc") return Promise.resolve(null)
      const candidate = [
        { id: 29, status: "published", room_id: 99 },
        { ...privateEntry, id: 28, status: "published" },
        { id: 27, status: "draft", room_id: 4 },
        { id: 26, status: "published", room_id: 4, created_at: new Date("2026-09-01T10:00:00Z") },
      ].find(candidate => cursor == null || (orderBy[0].published_at === "desc" ? candidate.id < cursor.id : candidate.id > cursor.id))
      return Promise.resolve(candidate ?? null)
    })
    const result = await service.fetchEntry(30, 9)
    expect(result.entry.previous_author_entry?.id).toBe(26)
    expect(result.entry.next_author_entry).toBeNull()
    expect(service.circleAccess.resolve).not.toHaveBeenCalledWith(99, 9)
    expect(service.circleAccess.resolve).toHaveBeenCalledWith(4, 9)
    expect(service.prisma.entry.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([{ room_id: 4, user_id: 2 }]) }),
    }))
    expect(service.prisma.entry.findFirst.mock.calls[0][0].where).not.toHaveProperty("room_id")
  })

  it("finds project copies from all contributors and source entries without inheriting circle access", async () => {
    const service = readService()
    service.prisma.project.findUnique.mockResolvedValue({ owner_id: 1, participations: [{ id: 7 }] })
    service.circleAccess.resolve.mockImplementation((targetRoomId: number) => Promise.resolve(targetRoomId === 4 ? { kind: "member" } : null))
    projectCandidate.mockImplementation((_database, _projectId, _currentId, _timestamp, previous, cursorId) => {
      if (previous) return Promise.resolve(null)
      return Promise.resolve(cursorId == null
        ? { id: 31, status: "published", room_id: 99, user_id: 3, source_entry_id: 13 }
        : cursorId === 31 ? { id: 32, status: "published", room_id: 4, user_id: 3, source_entry_id: 13 } : null)
    })
    const result = await service.fetchEntry(30, 9)
    expect(result.entry.next_project_entry?.id).toBe(32)
    expect(result.entry.next_author_entry).toBeNull()
    expect(service.prisma.entry.findMany).not.toHaveBeenCalled()
    expect(projectCandidate).toHaveBeenCalledWith(service.prisma, 8, 30, expect.any(Date), false, 31, 4)
    expect(service.circleAccess.resolve).not.toHaveBeenCalledWith(99, 9)
  })

  it("permits visitor adjacency only to this room's readable published shares", async () => {
    const service = readService()
    service.circleAccess.resolve.mockResolvedValue({ kind: "visitor" })
    service.circleAccess.canReadPublishedPostWithRoomHistory.mockImplementation((candidate) => Promise.resolve(candidate.id === 32))
    service.prisma.entry.findFirst.mockImplementation(({ orderBy, cursor }) => {
      if (orderBy[0].published_at === "desc") return Promise.resolve(null)
      return Promise.resolve(cursor?.id === 31
        ? { id: 32, status: "published", room_id: 4 }
        : { id: 31, status: "published", room_id: 4 })
    })
    const result = await service.fetchEntry(30, 9)
    expect(result.entry.next_author_entry?.id).toBe(32)
    expect(service.circleAccess.canReadPublishedPostWithRoomHistory).toHaveBeenCalledTimes(2)
  })
  it("lists only authorized room copies and never private source content", async () => {
    const service = readService()
    const anchor = { id: 30, room_id: 4, room_project: { name: "Private practice" }, room: { id: 4, name: "Room" } }
    const fetch = vi.spyOn(service, "fetchEntry").mockImplementation(async id => {
      if (id === 29) throw new ForbiddenException()
      return { entry: id === 30 ? anchor : { id, room_id: 4 }, replies: { data: [], pagination: {} } } as never
    })
    service.prisma.entry.findMany.mockResolvedValueOnce([{ id: 12 }, { id: 13 }])
      .mockResolvedValueOnce([{ id: 30 }, { id: 29 }, { id: 28 }])
    const result = await service.roomProjectShares(30, 9)
    expect(result.items.map(item => item.id)).toEqual([30, 28])
    expect(service.prisma.entry.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { room_id: 4, status: "published", source_entry_id: { in: [12, 13] } },
      take: 21,
    }))
    expect(fetch).not.toHaveBeenCalledWith(12, 9)
    expect(result.nextCursor).toBeNull()
  })

  it("authorizes the anchor before querying project sources", async () => {
    const service = readService()
    vi.spyOn(service, "fetchEntry").mockRejectedValue(new ForbiddenException())
    await expect(service.roomProjectShares(30, 9)).rejects.toBeInstanceOf(ForbiddenException)
    expect(service.prisma.entry.findMany).not.toHaveBeenCalled()
  })

  it("paginates room copies using the last candidate even if some are unreadable", async () => {
    const service = readService()
    vi.spyOn(service, "fetchEntry").mockResolvedValue({
      entry: { id: 30, room_id: 4, room_project: { name: "Project" } },
    } as never)
    service.prisma.entry.findMany.mockResolvedValueOnce([{ id: 12 }])
      .mockResolvedValueOnce(Array.from({ length: 21 }, (_, index) => ({ id: 100 - index })))
    const result = await service.roomProjectShares(30, 9, 120)
    expect(result.nextCursor).toBe(81)
    expect(result.items).toHaveLength(20)
    expect(service.prisma.entry.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { lt: 120 }, room_id: 4 }),
    }))
  })

})
