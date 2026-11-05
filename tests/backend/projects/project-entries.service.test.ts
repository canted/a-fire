import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common"
import { ProjectEntriesService } from "@server/api/v1/projects/project-entries.service"
import { vi } from "vitest"
import { Prisma } from "@prisma/client"
import { ProjectsController } from "@server/api/v1/projects/projects.controller"

const analyticsCapture = vi.hoisted(() => vi.fn());
vi.mock("@server/runtime/posthog", async importOriginal => ({ ...await importOriginal<typeof import("@server/runtime/posthog")>(), capturePosthogEvent: analyticsCapture }));
const now = new Date("2026-10-02T10:00:00Z")
const material = {
  id: 40, user_id: 2, project_id: 7, room_id: null,
  status: "published", creation_origin: "project_material", format: "mixed_media", format_data: null,
  project_intent: "Listen for space", project_question: "What feels unfinished?", project_lyrics: "An old line",
  source_entry_id: null, source_shared_entry_id: null, source_reply_id: null, source_chat_message_id: null, source_author_name: null,
  created_at: now, updated_at: now, published_at: now, content: null,
  user: { id: 2, username: "taisha" },
}
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] })
const sourceContent = { type: "doc", content: [paragraph("Selected text"), { type: "image", attrs: { src: "/api/v1/uploads/101", width: 400, height: 300 } }, { type: "audio", attrs: { audioAssetId: 12, src: "/api/v1/audio_assets/12" } }] }

function makeService() {
  const docs = new Map<string, unknown>([["Post:40", sourceContent]])
  const posts = new Map<number, any>([[40, { ...material }]])
  let nextId = 100
  const prisma = {
    project: {
      findUnique: vi.fn().mockImplementation((args) => Promise.resolve({ owner_id: 2, participations: args.select?.participations?.where?.user_id === 2 ? [{ id: 11 }] : [] })),
      update: vi.fn(),
    },
    entry: {
      findUnique: vi.fn().mockImplementation(({ where }) => Promise.resolve(where.user_id_share_request_key ? [...posts.values()].find(post => post.user_id === where.user_id_share_request_key.user_id && post.share_request_key === where.user_id_share_request_key.share_request_key) ?? null : posts.get(where.id) ?? null)),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }) => {
        const post = { ...material, id: nextId++, ...data, user: { id: data.user_id, username: data.user_id === 1 ? "will" : "taisha" } }
        posts.set(post.id, post)
        return Promise.resolve(post)
      }),
      update: vi.fn().mockImplementation(({ where, data }) => {
        const post = { ...posts.get(where.id), ...data }
        posts.set(post.id, post)
        return Promise.resolve(post)
      }),
    },
    document: {
      findFirst: vi.fn().mockImplementation(({ where }) => Promise.resolve(docs.has(`${where.docable_type}:${where.docable_id}`) ? { content: docs.get(`${where.docable_type}:${where.docable_id}`) } : null)),
      create: vi.fn().mockImplementation(({ data }) => { docs.set(`${data.docable_type}:${data.docable_id}`, data.content); return Promise.resolve({ id: 1 }) }),
      upsert: vi.fn().mockImplementation(({ create }) => { docs.set(`${create.docable_type}:${create.docable_id}`, create.content); return Promise.resolve({ id: 1 }) }),
    },
    reply: { findUnique: vi.fn() },
    chatMessage: { findUnique: vi.fn() },
    audioAsset: { findMany: vi.fn().mockResolvedValue([]) },
    videoAsset: { findMany: vi.fn().mockResolvedValue([]) },
    activeStorageBlob: { findMany: vi.fn().mockResolvedValue([]) },
    activeStorageAttachment: { findMany: vi.fn().mockResolvedValue([]) },
    roomMembership: { findFirst: vi.fn().mockResolvedValue({ username_override: "Circle author" }), findMany: vi.fn().mockResolvedValue([{ room_id: 4 }]) },
    square: { findFirst: vi.fn().mockResolvedValue({ id: 22, user_id: 2, room_id: 4, board_id: 3 }) },
    round: { findUnique: vi.fn() },
    room: { findUnique: vi.fn().mockResolvedValue({ reply_mode: "simple" }) },
    board: { findUnique: vi.fn().mockResolvedValue({ id: 3, reply_mode: "simple" }) },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn().mockImplementation(query => Promise.resolve(query.sql?.includes("WITH page AS MATERIALIZED") ? [] : [{ id: 40 }])),
    $transaction: vi.fn(),
  }
  prisma.$transaction.mockImplementation(async (callback) => {
    const beforePosts = structuredClone([...posts]), beforeDocs = structuredClone([...docs])
    try { return await callback(prisma) } catch (error) { posts.clear(); beforePosts.forEach(([id, post]) => posts.set(id, post)); docs.clear(); beforeDocs.forEach(([id, content]) => docs.set(id, content)); throw error }
  })
  const uploads = {
    copyContentSnapshot: vi.fn().mockImplementation((_user, _source, _target, content, formatData) => Promise.resolve({ content: structuredClone(content), formatData: structuredClone(formatData) })),
    assertContentMediaAccess: vi.fn(),
  }
  const circleAccess = { requireAccessesInTransaction: vi.fn().mockResolvedValue(new Map()), requireMemberInTransaction: vi.fn().mockResolvedValue({ kind: "member", canWriteWall: true }), requireMember: vi.fn().mockResolvedValue({ kind: "member", canWriteWall: true }), resolve: vi.fn().mockResolvedValue({ kind: "member" }) }
  const activities = { validateActivitySubmission: vi.fn() }
  const service = new ProjectEntriesService()
  Object.assign(service, { prisma, uploads, circleAccess, rounds: activities })
  return { service, prisma, uploads, circleAccess, rounds: activities, entries: posts, docs }
}

describe("ProjectEntriesService", () => {
  beforeEach(() => analyticsCapture.mockClear());
  it("records a first private save only after commit and keeps artwork out of analytics", async () => {
    const { service, entries } = makeService();
    entries.set(40, { ...material, status: "draft", published_at: null });
    await service.update(7, 40, 2, { save: true, expected_revision: now.getTime(), content: sourceContent });
    expect(analyticsCapture).toHaveBeenCalledWith(expect.objectContaining({ event: "project_entry_saved", distinctId: 2,
      properties: expect.objectContaining({ project_id: 7, entry_id: 40, has_audio: true, has_image: true }) }));
    expect(JSON.stringify(analyticsCapture.mock.calls)).not.toMatch(/Selected text|uploads\/101/);
    analyticsCapture.mockClear();
    await expect(service.update(7, 40, 2, { save: true, expected_revision: now.getTime() })).rejects.toThrow();
    expect(analyticsCapture).not.toHaveBeenCalled();
    await service.update(7, 40, 2, { save: true, expected_revision: entries.get(40).updated_at.getTime() });
    expect(analyticsCapture).toHaveBeenCalledWith(expect.objectContaining({ event: "project_entry_updated" }));
  });
  it("includes the latest circle icon with an accessible entry's shared copies", async () => {
    const { service, prisma } = makeService()
    prisma.entry.findMany.mockResolvedValue([{ id: 101, room_id: 4, round_id: null, square: { room: { name: "Evening Circle" } }, _count: { replies: 2 } }])
    prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 4, room: { name: "Evening Circle" } }])
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 101, room_id: 4, room_name: "Evening Circle", round_id: null, reply_count: 2n }]).mockResolvedValueOnce([{ record_id: 4, blob_id: 77 }])
    const entry = await service.show(7, 40, 2)
    expect(entry.submissions[0]).toMatchObject({ room_name: "Evening Circle", circle_icon_url: "/api/v1/uploads/77/variants/icon160", reply_count: 2 })
    expect(prisma.activeStorageAttachment.findMany).not.toHaveBeenCalled()
  })
  it("resumes the author's private draft and does not create a competing draft", async () => {
    const { service, prisma } = makeService()
    prisma.entry.findFirst.mockResolvedValueOnce({ ...material, status: "draft" })
    const entry = await service.create(7, 2)
    expect(entry).toMatchObject({ id: 40, draft: true, can_edit: true, can_share: false })
    expect(prisma.entry.create).not.toHaveBeenCalled()
    expect(prisma.entry.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ user_id: 2, creation_origin: "project_material", room_id: null }) }))
  })

  it("carries only the author's latest framing into a new empty draft", async () => {
    const { service, prisma } = makeService()
    prisma.entry.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ project_intent: "Keep listening", project_question: "Where is space?", project_lyrics: "A new line" })
    const entry = await service.create(7, 2)
    expect(entry).toMatchObject({ draft: true, intent: "Keep listening", question: "Where is space?", lyrics: "A new line", content: { type: "doc", content: [{ type: "paragraph", content: [] }] } })
    expect(prisma.entry.findFirst.mock.calls[1][0].where).toMatchObject({ user_id: 2, status: "published" })
  })

  it("starts explicit new material empty without resuming or changing any existing draft", async () => {
    const { service, prisma, entries: posts, docs } = makeService()
    posts.set(41, { ...material, id: 41, status: "draft", project_intent: "Unfinished work" })
    docs.set("Post:41", sourceContent)
    prisma.entry.findFirst.mockResolvedValue(posts.get(41))
    const before = structuredClone([...posts])
    const entry = await service.create(7, 2, { fresh: true })
    expect(entry).toMatchObject({ draft: true, intent: null, question: null, lyrics: null, content: { type: "doc", content: [{ type: "paragraph", content: [] }] } })
    expect(entry.id).not.toBe(41)
    expect(prisma.entry.findFirst).not.toHaveBeenCalled()
    expect([...posts].filter(([id]) => id < 100)).toEqual(before)
    expect(docs.get("Post:41")).toEqual(sourceContent)
  })

  it("validates fresh creation and still requires accepted project membership", async () => {
    const { service, prisma } = makeService()
    await expect(service.create(7, 2, { fresh: "true" })).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.create(7, 3, { fresh: true })).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.entry.create).not.toHaveBeenCalled()
  })

  it("forwards explicit fresh creation through the authenticated controller", () => {
    const controller = new ProjectsController()
    const entries = { create: vi.fn() }
    Object.assign(controller, { entries })
    const request = { user: { id: 2 } } as any
    controller.createEntry("7", request, { fresh: true })
    expect(entries.create).toHaveBeenLastCalledWith(7, 2, { fresh: true })
    controller.createEntry("7", request)
    expect(entries.create).toHaveBeenLastCalledWith(7, 2, {})
  })

  it("requires accepted project membership to create or list material", async () => {
    const { service, prisma } = makeService()
    await expect(service.create(7, 3)).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.page(7, 3)).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.entry.create).not.toHaveBeenCalled()
    expect(prisma.entry.findMany).not.toHaveBeenCalled()
  })

  it("keeps drafts private to their author, even from the project owner", async () => {
    const { service, entries: posts } = makeService()
    posts.set(40, { ...material, status: "draft" })
    await expect(service.show(7, 40, 1)).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.show(7, 40, 2)).resolves.toMatchObject({ id: 40, draft: true })
  })

  it("saves mixed-media material through existing document/media validation and no circle publication", async () => {
    const { service, prisma, uploads, entries: posts } = makeService()
    posts.set(40, { ...material, status: "draft", published_at: null })
    const result = await service.update(7, 40, 2, { expected_revision: now.getTime(), content: sourceContent, intent: "Changed intent", save: true })
    expect(result).toMatchObject({ status: "published", draft: false, intent: "Changed intent", can_share: true })
    expect(uploads.assertContentMediaAccess).toHaveBeenCalledWith(2, sourceContent, null)
    expect(prisma.document.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ ydoc_state: null, version: { increment: 1 } }) }))
    expect(prisma.entry.update.mock.calls[0][0].data).not.toHaveProperty("room_id")
    expect(prisma.entry.update.mock.calls[0][0].data).not.toHaveProperty("square_id")
  })

  it("denies peer edits and immutable feedback edits before any document mutation", async () => {
    const { service, prisma, entries: posts } = makeService()
    await expect(service.update(7, 40, 1, { expected_revision: now.getTime(), content: sourceContent })).rejects.toBeInstanceOf(ForbiddenException)
    posts.set(40, { ...material, creation_origin: "project_feedback" })
    await expect(service.update(7, 40, 2, { expected_revision: now.getTime(), content: sourceContent })).rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.document.upsert).not.toHaveBeenCalled()
  })

  it("rejects transient media, forged private media and invalid save flags before saving", async () => {
    const { service, prisma, uploads } = makeService()
    await expect(service.update(7, 40, 2, { expected_revision: now.getTime(), content: { type: "doc", content: [{ type: "image", attrs: { src: "blob:local" } }] } })).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.update(7, 40, 2, { expected_revision: now.getTime(), save: "false" as any })).rejects.toBeInstanceOf(BadRequestException)
    uploads.assertContentMediaAccess.mockRejectedValueOnce(new ForbiddenException("Forbidden"))
    await expect(service.update(7, 40, 2, { expected_revision: now.getTime(), content: sourceContent })).rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.document.upsert).not.toHaveBeenCalled()
  })

  it("shares revision-guarded whole units into an independent copy", async () => {
    const { service, prisma, uploads, docs } = makeService()
    const manifest = await service.shareSelection(7, 40, 2, 4)
    const mediaId = manifest.units.find(unit => unit.kind === "media" && unit.content.content?.[0].type === "audio")!.id
    const result = await service.shareDraft(7, 40, 2, { room_id: 4, source_revision: manifest.revision, selected_unit_ids: ["body", mediaId], request_key: "request-1", room_statement: "A new version" })
    expect(result).toEqual({ entry_id: 100, path: "/app/new-entry?draftId=100" })
    expect(prisma.square.findFirst).not.toHaveBeenCalled()
    expect(prisma.entry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ project_id: null, source_entry_id: 40, room_statement: "A new version", room_id: 4, status: "draft" }) }))
    const copied = uploads.copyContentSnapshot.mock.calls[0]
    expect(copied.slice(0, 3)).toEqual([2, { sourceType: "Post", sourceId: 40 }, 100])
    expect(JSON.stringify(copied[3])).toContain("Selected text")
    expect(JSON.stringify(copied[3])).toContain("An old line")
    expect(JSON.stringify(copied[3])).not.toContain("uploads/101")
    expect(copied[4]).toEqual({})
    docs.set("Post:40", { type: "doc", content: [paragraph("Changed later")] })
    expect(docs.get("Post:100")).toEqual(copied[3])
  })

  it("rejects stale, empty, unknown and legacy positional selections before allocating a copy", async () => {
    const { service, prisma, docs } = makeService()
    const manifest = await service.shareSelection(7, 40, 2, 4)
    for (const input of [{ selected_node_indices: [0] }, { intent: "Replacement" }, { question: "Replacement" }, { selected_unit_ids: [] }, { source_revision: manifest.revision, selected_unit_ids: ["unknown"] }, { source_revision: manifest.revision, selected_unit_ids: [] }]) {
      await expect(service.shareDraft(7, 40, 2, { room_id: 4, request_key: "request-2", ...input })).rejects.toBeInstanceOf(BadRequestException)
    }
    docs.set("Post:40", { type: "doc", content: [paragraph("Changed")] })
    await expect(service.shareDraft(7, 40, 2, { room_id: 4, request_key: "request-3", source_revision: manifest.revision, selected_unit_ids: ["body"] })).rejects.toThrow("changed")
    expect(prisma.entry.create).not.toHaveBeenCalled()
  })

  it("omits deselected media and hidden format metadata", async () => {
    const { service, uploads, entries: posts } = makeService()
    posts.set(40, { ...material, format_data: { image_url: "/api/v1/uploads/101", audio_asset_id: 12, private_note: "Unshared text" } })
    const manifest = await service.shareSelection(7, 40, 2, 4)
    await service.shareDraft(7, 40, 2, { room_id: 4, request_key: "request-4", source_revision: manifest.revision, selected_unit_ids: ["body"] })
    expect(uploads.copyContentSnapshot.mock.calls[0][4]).toEqual({})
    expect(JSON.stringify(uploads.copyContentSnapshot.mock.calls[0][3])).not.toContain("audioAssetId")
    expect(JSON.stringify(uploads.copyContentSnapshot.mock.calls[0][3])).not.toContain("uploads/101")
  })

  it("replays a request without another copy and rejects key reuse with different input", async () => {
    const { service, prisma, uploads, docs } = makeService()
    const manifest = await service.shareSelection(7, 40, 2, 4)
    const input = { room_id: 4, request_key: "repeat-share", source_revision: manifest.revision, selected_unit_ids: ["body"] }
    const first = await service.shareDraft(7, 40, 2, input)
    docs.set("Post:40", { type: "doc", content: [paragraph("Later revision")] })
    expect(await service.shareDraft(7, 40, 2, input)).toEqual(first)
    expect(prisma.entry.create).toHaveBeenCalledTimes(1)
    expect(uploads.copyContentSnapshot).toHaveBeenCalledTimes(1)
    expect(analyticsCapture.mock.calls.filter(([event]) => event.event === "entry_share_prepared")).toHaveLength(1)
    expect(analyticsCapture).toHaveBeenCalledWith(expect.objectContaining({ event: "entry_share_prepared", properties: expect.objectContaining({ source_entry_id: 40, project_id: 7, room_id: 4, entry_id: first.entry_id }) }))
    await expect(service.shareDraft(7, 40, 2, { ...input, room_statement: "Changed" })).rejects.toThrow("different selection")
  })

  it("copies only explicitly selected same-room feedback with attribution and independent media ownership", async () => {
    const { service, prisma, entries: posts, docs, uploads } = makeService()
    const saved = { ...material, id: 60, creation_origin: "project_feedback", source_entry_id: 40, source_reply_id: 70, source_shared_entry_id: 50, source_room_id: 4, source_author_id: 9, source_author_name: "Reviewer", source_room_ids: [4] }
    posts.set(60, saved)
    prisma.entry.findMany.mockImplementation(({ where }) => Promise.resolve(where.source_reply_id ? [saved] : []))
    prisma.reply.findUnique.mockResolvedValue({ id: 70, user_id: 9, status: "published", entry: { id: 50, room_id: 4, status: "published" } })
    docs.set("Post:60", { type: "doc", content: [{ type: "audio", attrs: { audioAssetId: 90 } }] })
    const manifest = await service.shareSelection(7, 40, 2, 4)
    expect(manifest.units.find(unit => unit.id === "feedback:60")).toMatchObject({ eligible: true, authorName: "Reviewer" })
    await service.shareDraft(7, 40, 2, { room_id: 4, request_key: "save-selection", source_revision: manifest.revision, selected_unit_ids: ["feedback:60"] })
    expect(posts.get(100).shared_feedback).toEqual([expect.objectContaining({ source_reply_id: 70, source_room_id: 4, source_author_id: 9, author_name: "Reviewer" })])
    expect(posts.get(100).shared_feedback[0]).not.toHaveProperty("project_id")
    expect(posts.get(100).shared_feedback[0]).not.toHaveProperty("source_entry_id")
    expect(uploads.copyContentSnapshot.mock.calls[1].slice(0, 3)).toEqual([2, { sourceType: "Post", sourceId: 60 }, 100])
    expect(posts.get(100).source_room_ids).toEqual([4])
    await service.shareDraft(7, 40, 2, { room_id: 4, request_key: "full-no-feedback" })
    expect(posts.get(101).shared_feedback).toEqual([])
  })

  it("rejects foreign-room, inherited foreign origins and withdrawn feedback before any copy", async () => {
    const { service, prisma, docs, entries: posts } = makeService()
    const saved = { ...material, id: 60, creation_origin: "project_feedback", source_entry_id: 40, source_reply_id: 70, source_shared_entry_id: 50, source_room_id: 4, source_room_ids: [4, 8] }
    posts.set(60, saved)
    docs.set("Post:60", { type: "doc", content: [paragraph("Saved reply")] })
    prisma.entry.findMany.mockResolvedValue([saved])
    prisma.reply.findUnique.mockResolvedValue({ id: 70, status: "published", entry: { id: 50, room_id: 4, status: "published" } })
    let manifest = await service.shareSelection(7, 40, 2, 4)
    expect(manifest.units.find(unit => unit.id === "feedback:60")?.eligible).toBe(false)
    await expect(service.shareDraft(7, 40, 2, { room_id: 4, request_key: "foreign-save", source_revision: manifest.revision, selected_unit_ids: ["feedback:60"] })).rejects.toThrow("cannot be shared")
    saved.source_room_ids = [4]
    manifest = await service.shareSelection(7, 40, 2, 4)
    prisma.reply.findUnique.mockResolvedValue(null)
    await expect(service.shareDraft(7, 40, 2, { room_id: 4, request_key: "withdrawn-save", source_revision: manifest.revision, selected_unit_ids: ["feedback:60"] })).rejects.toThrow("changed")
    expect(prisma.entry.create).not.toHaveBeenCalled()
  })

  it("rejects statement-only copies and retains inherited restrictions on full copies", async () => {
    const { service, entries: posts, docs, prisma } = makeService()
    posts.set(40, { ...material, source_room_ids: [8] })
    await expect(service.shareDraft(7, 40, 2, { room_id: 4 })).rejects.toThrow("original room")
    posts.set(40, { ...material, project_intent: null, project_question: null, project_lyrics: null })
    docs.set("Post:40", { type: "doc", content: [] })
    await expect(service.shareDraft(7, 40, 2, { room_id: 4, request_key: "statement-only", room_statement: "Only this" })).rejects.toThrow("meaningful")
    expect(prisma.entry.create).not.toHaveBeenCalled()
  })

  it("prevents sharing peers' material, unaccepted membership and circle visitors", async () => {
    const { service, prisma, circleAccess } = makeService()
    await expect(service.shareDraft(7, 40, 1, { room_id: 4 })).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.shareDraft(7, 40, 3, { room_id: 4 })).rejects.toBeInstanceOf(ForbiddenException)
    circleAccess.requireMember.mockRejectedValueOnce(new ForbiddenException("Members only"))
    await expect(service.shareDraft(7, 40, 2, { room_id: 4 })).rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.entry.create).not.toHaveBeenCalled()
  })

  it.each(["room", "round"])("rejects empty guided feedback defaults from %s before copying material", async scope => {
    const { service, prisma, uploads } = makeService()
    prisma.room.findUnique.mockResolvedValue({ id: 4, reply_mode: "guided", default_feedback_types: [] })
    prisma.round.findUnique.mockResolvedValue({ updated_at: now, id: 9, room_id: 4, board_id: 3, reply_mode: "guided", requested_feedback_types: [] })
    await expect(service.shareDraft(7, 40, 2, { room_id: 4, ...(scope === "round" ? { round_id: 9 } : {}) })).rejects.toThrow("Guided feedback needs at least one feedback type")
    expect(prisma.entry.create).not.toHaveBeenCalled()
    expect(uploads.copyContentSnapshot).not.toHaveBeenCalled()
  })

  it("uses canonical activity role, deadline and activity validation before cloning", async () => {
    const { service, prisma, rounds: activities, uploads } = makeService()
    prisma.round.findUnique.mockResolvedValue({ updated_at: now, id: 9, room_id: 4, board_id: 3, reply_mode: "guided", requested_feedback_types: ["question"], idea_guidance: "craft" })
    activities.validateActivitySubmission.mockRejectedValueOnce(new BadRequestException("Activity submissions are closed"))
    await expect(service.shareDraft(7, 40, 2, { room_id: 4, round_id: 9 })).rejects.toBeInstanceOf(BadRequestException)
    expect(uploads.copyContentSnapshot).not.toHaveBeenCalled()
    expect(prisma.entry.create).not.toHaveBeenCalled()
    await service.shareDraft(7, 40, 2, { room_id: 4, round_id: 9 })
    expect(activities.validateActivitySubmission).toHaveBeenCalledWith(9, 2)
    expect(prisma.entry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ round_id: 9, requested_feedback_types: ["question"], idea_guidance: "craft" }) }))
  })

  it("keeps accessible feedback as a project-owned immutable snapshot with source identity", async () => {
    const { service, prisma, uploads, docs } = makeService()
    const replyContent = { type: "doc", content: [paragraph("Feedback to keep")] }
    docs.set("Reply:70", replyContent)
    prisma.reply.findUnique.mockResolvedValue({ id: 70, status: "published", user: { username: "Reviewer" }, entry: { id: 50, status: "published", room_id: 4, source_entry_id: 40 } })
    const kept = await service.keep(7, 2, 70)
    expect(kept).toMatchObject({ id: 100, already_saved: false, kind: "feedback", can_edit: false, can_share: false, source_entry_id: 40, source_shared_entry_id: 50, source_reply_id: 70, source_author_name: "Reviewer", source_available: true, content: replyContent })
    expect(uploads.copyContentSnapshot).toHaveBeenCalledWith(2, { sourceType: "Reply", sourceId: 70 }, 100, replyContent, null, prisma)
  })

  it("keeps an existing snapshot readable after its reply or submission is deleted and does not recopy", async () => {
    const { service, prisma, uploads, docs, entries: posts } = makeService()
    const kept = { ...material, id: 100, creation_origin: "project_feedback", source_reply_id: 70, source_shared_entry_id: 50, source_author_name: "Reviewer" }
    posts.set(100, kept)
    const savedContent = { type: "doc", content: [paragraph("Original feedback")] }
    docs.set("Post:100", savedContent)
    prisma.entry.findFirst.mockResolvedValue(kept)
    prisma.reply.findUnique.mockResolvedValue(null)
    const result = await service.keep(7, 2, 70)
    expect(result).toMatchObject({ id: 100, already_saved: true, content: savedContent, source_available: false, source_author_name: "Reviewer" })
    expect(uploads.copyContentSnapshot).not.toHaveBeenCalled()
    expect(prisma.entry.create).not.toHaveBeenCalled()
  })

  it("reports the winning saved copy when a concurrent save publishes first", async () => {
    const { service, prisma, entries: posts } = makeService()
    const winner = { ...material, id: 99, creation_origin: "project_feedback", source_reply_id: 70 }
    posts.set(99, winner)
    prisma.reply.findUnique.mockResolvedValue({ id: 70, status: "published", user: { username: "Reviewer" }, entry: { id: 50, status: "published", room_id: 4, source_entry_id: 40 } })
    prisma.entry.findFirst.mockResolvedValueOnce(null).mockResolvedValue(winner)
    const update = prisma.entry.update.getMockImplementation()!
    prisma.entry.update.mockImplementation(args => {
      if (args.data.status === "published" && args.data.source_reply_id === 70)
        return Promise.reject(new Prisma.PrismaClientKnownRequestError("Duplicate saved reply", { code: "P2002", clientVersion: "test" }))
      return update(args)
    })
    expect(await service.keep(7, 2, 70)).toMatchObject({ id: 99, already_saved: true })
    expect(posts.has(100)).toBe(false)
  })

  it("does not let project membership expose feedback from a circle the saver cannot read", async () => {
    const { service, prisma, uploads, circleAccess } = makeService()
    prisma.reply.findUnique.mockResolvedValue({ id: 70, status: "published", user: { username: "Reviewer" }, entry: { id: 50, status: "published", room_id: 4, source_entry_id: 40 } })
    circleAccess.requireMember.mockRejectedValueOnce(new ForbiddenException("Members only"))
    await expect(service.keep(7, 2, 70)).rejects.toBeInstanceOf(ForbiddenException)
    expect(uploads.copyContentSnapshot).not.toHaveBeenCalled()
  })

  it("does not offer inaccessible source links to project members outside the original circle", async () => {
    const { service, prisma, circleAccess } = makeService()
    const kept = { ...material, id: 100, creation_origin: "project_feedback", source_reply_id: 70 }
    prisma.entry.findFirst.mockResolvedValue(kept)
    prisma.reply.findUnique.mockResolvedValue({ status: "published", entry: { status: "published", room_id: 4 } })
    circleAccess.resolve.mockResolvedValue(null)
    await expect(service.keep(7, 2, 70)).resolves.toMatchObject({ source_available: false })
  })

  it("rejects unpublished feedback and saves unrelated feedback without a false source entry", async () => {
    const { service, prisma, entries: posts } = makeService()
    prisma.reply.findUnique.mockResolvedValue({ id: 70, status: "draft", entry: { id: 50, status: "published", room_id: 4, source_entry_id: 40 } })
    await expect(service.keep(7, 2, 70)).rejects.toBeInstanceOf(NotFoundException)
    prisma.reply.findUnique.mockResolvedValue({ id: 70, status: "published", entry: { id: 50, status: "published", room_id: 4, source_entry_id: 40 } })
    posts.set(40, { ...material, project_id: 8 })
    await expect(service.keep(7, 2, 70)).resolves.toMatchObject({ source_shared_entry_id: 50, source_entry_id: undefined })
  })

  it("preserves every source unit on a full-copy share but does not select private feedback", async () => {
    const { service, uploads } = makeService()
    await service.shareDraft(7, 40, 2, { room_id: 4 })
    expect(JSON.stringify(uploads.copyContentSnapshot.mock.calls[0][3])).toContain("An old line")
    expect(uploads.copyContentSnapshot.mock.calls[0][4]).toEqual({ title: material.project_intent })
  })

  it("hydrates the database page in its supplied grouped order", async () => {
    const { service, prisma } = makeService()
    const row = (id: number, origin: string, day: number, sourceId: number | null = null) => ({ ...material, id, creation_origin: origin, source_entry_id: sourceId, published_at: new Date(`2026-10-${String(day).padStart(2, "0")}T10:00:00Z`) })
    prisma.entry.findMany.mockResolvedValueOnce([
      row(54, "project_feedback", 8, 40), row(53, "project_feedback", 7, 40),
      row(52, "project_feedback", 6), row(51, "project_material", 5), row(40, "project_material", 2),
    ])
    prisma.$queryRaw.mockResolvedValueOnce([52,51,40,53,54].map(id => ({ id })))
    const { entries: result } = await service.page(7, 2)
    expect(result.map(entry => entry.id)).toEqual([52, 51, 40, 53, 54])
    expect(result.filter(entry => entry.kind === "feedback")).toHaveLength(3)
  })

  it("keeps an activity reply without a project source and preserves its circle display name", async () => {
    const { service, prisma, uploads } = makeService()
    prisma.reply.findUnique.mockResolvedValue({ id: 70, user_id: 3, status: "published", user: { username: "Account name" }, entry: { id: 50, round_id: 9, status: "published", room_id: 4, source_entry_id: null } })
    const result = await service.keep(7, 2, 70)
    expect(result).toMatchObject({ kind: "feedback", source_shared_entry_id: 50, source_reply_id: 70, source_entry_id: undefined, source_author_name: "Circle author" })
    expect(uploads.copyContentSnapshot).toHaveBeenCalledWith(2, { sourceType: "Reply", sourceId: 70 }, result.id, expect.anything(), null, expect.anything())
  })

  it("allows optional title/body/media but rejects empty saved private entries before writes", async () => {
    const { service, docs, prisma, entries: posts } = makeService()
    posts.set(40, { ...material, project_intent: null, project_question: null, project_lyrics: null })
    docs.set("Post:40", { type: "doc", content: [paragraph(" ")] })
    await expect(service.update(7, 40, 2, { expected_revision: now.getTime(), save: true })).rejects.toThrow("Add a title")
    expect(prisma.entry.update).not.toHaveBeenCalled()
    await expect(service.update(7, 40, 2, { expected_revision: now.getTime(), save: true, intent: "Only a title" })).resolves.toMatchObject({ status: "published", intent: "Only a title" })
  })

  it("copies eligible phase entries independently and rejects text hidden in image-only imports", async () => {
    const { service, docs, prisma, entries: posts, rounds: activities, uploads } = makeService()
    prisma.round.findUnique.mockResolvedValue({ updated_at: now, id: 9, room_id: 4, board_id: 3, template_key: "art_before_chorus" })
    await expect(service.shareDraft(7, 40, 2, { room_id: 4, round_id: 9, creation_origin: "round_activity_cover" })).rejects.toThrow("images only")
    expect(prisma.entry.create).not.toHaveBeenCalled()
    posts.set(40, { ...material, project_intent: null, project_question: null, project_lyrics: null })
    const images = { type: "doc", content: [sourceContent.content[1]] }
    docs.set("Post:40", images)
    await service.shareDraft(7, 40, 2, { room_id: 4, round_id: 9, creation_origin: "round_activity_cover" })
    expect(activities.validateActivitySubmission).toHaveBeenCalledWith(9, 2, "round_activity_cover")
    expect(prisma.square.findFirst).not.toHaveBeenCalled()
    expect(prisma.entry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ source_entry_id: 40, project_id: null, room_id: 4, creation_origin: "round_activity_cover" }) }))
    expect(uploads.copyContentSnapshot).toHaveBeenCalledWith(2, { sourceType: "Post", sourceId: 40 }, 100, images, expect.anything(), expect.anything())
    expect(docs.get("Post:40")).toEqual(images)
  })

  it("marks failed copies inaccessible and never returns a published partial snapshot", async () => {
    const { service, prisma, uploads } = makeService()
    uploads.copyContentSnapshot.mockRejectedValueOnce(new Error("Storage unavailable"))
    await expect(service.shareDraft(7, 40, 2, { room_id: 4 })).rejects.toThrow("Storage unavailable")
    expect(prisma.document.create).not.toHaveBeenCalled()
  })
})


describe("Chat messages kept in projects", () => {
  const message = { id: 80, room_id: 4, author_id: 9, author: { username: "Original author" }, status: "published", timeline_kind: "message", body: "A useful idea", content: sourceContent }
  function setup() {
    const result = makeService()
    result.prisma.project.findUnique.mockResolvedValue({ owner_id: 2, participations: [] })
    result.prisma.chatMessage.findUnique.mockResolvedValue(message)
    return result
  }

  it("creates the same immutable feedback snapshot with circle attribution and canonical media copying", async () => {
    const { service, prisma, uploads, circleAccess } = setup()
    const kept = await service.keepChatMessage(7, 2, 80)
    expect(circleAccess.requireMember).toHaveBeenCalledWith(4, 2)
    expect(uploads.copyContentSnapshot).toHaveBeenCalledWith(2, { sourceType: "ChatMessage", sourceId: 80 }, 100, sourceContent, null, expect.anything())
    expect(kept).toMatchObject({ kind: "feedback", author: { id: 2 }, source_author_name: "Circle author", source_chat_message_id: 80, source_room_id: 4, source_available: true, can_edit: false, can_share: false, content: expect.objectContaining({ type: "doc" }) })
    expect(prisma.entry.create.mock.calls[0][0].data).toMatchObject({ project_id: 7, user_id: 2, creation_origin: "project_feedback", status: "draft", locked: true })
    expect(prisma.project.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7 } }))
  })

  it("supports legacy text-only messages and falls back to the original username", async () => {
    const { service, prisma, uploads } = setup()
    prisma.project.findUnique.mockResolvedValue({ owner_id: 1, participations: [] })
    prisma.chatMessage.findUnique.mockResolvedValue({ ...message, content: null })
    prisma.roomMembership.findFirst.mockResolvedValue(null)
    expect(await service.keepChatMessage(7, 1, 80)).toMatchObject({ source_author_name: "Original author", content: { type: "doc", content: [paragraph("A useful idea")] } })
    expect(uploads.copyContentSnapshot).toHaveBeenCalledTimes(1)
  })

  it("copies the canonical linked-post assets for an older converted message", async () => {
    const { service, prisma, uploads, docs } = setup()
    const post = { id: 55, status: "published", room_id: 4, format: "audio", format_data: { audio_asset_id: 12, name: "Original recording" } }
    prisma.chatMessage.findUnique.mockResolvedValue({ ...message, entry: post })
    docs.set("Post:55", sourceContent)
    expect(await service.keepChatMessage(7, 2, 80)).toMatchObject({ format: "audio", source_chat_message_id: 80 })
    expect(uploads.copyContentSnapshot).toHaveBeenCalledWith(2, { sourceType: "Post", sourceId: 55 }, 100, sourceContent, post.format_data, expect.anything())
  })

  it("keeps Chat saves at project level even when the original message links an entry", async () => {
    const { service, prisma, entries: posts } = setup()
    prisma.chatMessage.findUnique.mockResolvedValue({ ...message, entry: { id: 50, status: "published", room_id: 4, source_entry_id: 40, format: "mixed_media" } })
    await expect(service.keepChatMessage(7, 2, 80)).resolves.toMatchObject({ source_entry_id: undefined, source_shared_entry_id: 50 })
    posts.set(40, { ...material, project_id: 8 })
    await expect(service.keepChatMessage(7, 2, 80)).resolves.toMatchObject({ source_entry_id: undefined, source_shared_entry_id: 50 })
  })

  it.each([{ status: "draft", room_id: 4 }, { status: "published", room_id: 99 }, { status: "published", room_id: 4, project_id: 8 }])("never copies an unpublished, private-Project or foreign-circle linked post", async (post) => {
    const { service, prisma, uploads } = setup()
    prisma.chatMessage.findUnique.mockResolvedValue({ ...message, entry: { ...post, id: 55 } })
    await service.keepChatMessage(7, 2, 80)
    expect(uploads.copyContentSnapshot).toHaveBeenCalledWith(2, { sourceType: "ChatMessage", sourceId: 80 }, 100, sourceContent, null, expect.anything())
  })

  it("requires project ownership and source circle membership before copying", async () => {
    const { service, prisma, circleAccess, uploads } = setup()
    await expect(service.keepChatMessage(7, 3, 80)).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.chatMessage.findUnique).not.toHaveBeenCalled()
    circleAccess.requireMember.mockRejectedValueOnce(new ForbiddenException("Members only"))
    await expect(service.keepChatMessage(7, 2, 80)).rejects.toBeInstanceOf(ForbiddenException)
    expect(uploads.copyContentSnapshot).not.toHaveBeenCalled()
    expect(prisma.entry.create).not.toHaveBeenCalled()
  })

  it.each([null, { ...message, status: "draft" }, { ...message, status: "deleted" }, { ...message, timeline_kind: "round_event" }, { ...message, timeline_kind: "post_announcement" }])("rejects an unavailable or non-message source", async (source) => {
    const { service, prisma } = setup()
    prisma.chatMessage.findUnique.mockResolvedValue(source)
    await expect(service.keepChatMessage(7, 2, 80)).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.entry.create).not.toHaveBeenCalled()
  })

  it("returns the original snapshot on repeat save even after the source disappears", async () => {
    const { service, prisma, uploads, entries: posts, docs } = setup()
    const first = await service.keepChatMessage(7, 2, 80)
    prisma.entry.findFirst.mockResolvedValue(posts.get(first.id))
    prisma.chatMessage.findUnique.mockResolvedValue(null)
    docs.set(`Post:${first.id}`, first.content)
    const repeated = await service.keepChatMessage(7, 2, 80)
    expect(repeated).toMatchObject({ id: first.id, content: first.content, source_author_name: "Circle author", source_available: false, source_room_id: null })
    expect(prisma.entry.create).toHaveBeenCalledTimes(1)
    expect(uploads.copyContentSnapshot).toHaveBeenCalledTimes(1)
  })

  it("hides the chat source link from project members outside the circle", async () => {
    const { service, circleAccess } = setup()
    circleAccess.resolve.mockResolvedValue(null)
    expect(await service.keepChatMessage(7, 2, 80)).toMatchObject({ source_available: false, source_room_id: null, content: expect.objectContaining({ type: "doc" }) })
  })

  it("rolls back a failed copy without retaining a partial snapshot", async () => {
    const { service, uploads, entries: posts } = setup()
    uploads.copyContentSnapshot.mockRejectedValueOnce(new Error("Storage unavailable"))
    await expect(service.keepChatMessage(7, 2, 80)).rejects.toThrow("Storage unavailable")
    expect(posts.has(100)).toBe(false)
  })

  it("returns the winner of concurrent saves and rolls back the losing draft", async () => {
    const { service, prisma, entries: posts } = setup()
    const saved = { ...material, id: 99, creation_origin: "project_feedback", source_chat_message_id: 80 }
    prisma.entry.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(saved)
    const update = prisma.entry.update.getMockImplementation()!
    prisma.entry.update.mockImplementation((args) => args.data.source_chat_message_id === 80
      ? Promise.reject(new Prisma.PrismaClientKnownRequestError("Already saved", { code: "P2002", clientVersion: "6" }))
      : update(args))
    expect(await service.keepChatMessage(7, 2, 80)).toMatchObject({ id: 99 })
    expect(posts.has(100)).toBe(false)
  })

  it("keeps the existing endpoint backward compatible and requires exactly one valid source", async () => {
    const controller = new ProjectsController()
    const entries = { keep: vi.fn(), keepChatMessage: vi.fn() }
    Object.assign(controller, { entries })
    const request = { user: { id: 2 } } as any
    controller.keep("7", { reply_id: 70 }, request)
    controller.keep("7", { chat_message_id: 80 }, request)
    expect(entries.keep).toHaveBeenCalledWith(7, 2, 70)
    expect(entries.keepChatMessage).toHaveBeenCalledWith(7, 2, 80)
    for (const body of [{}, { reply_id: 70, chat_message_id: 80 }, { chat_message_id: 0 }, { chat_message_id: NaN }]) {
      expect(() => controller.keep("7", body, request)).toThrow(BadRequestException)
    }
  })
})

describe("owner reply-card keeps", () => {
  function setup() {
    const context = makeService()
    context.entries.set(50, { ...material, id: 50, room_id: 4, project_id: null, source_entry_id: 40, creation_origin: "project_share" })
    context.prisma.entry.findMany.mockImplementation(({ where }) => Promise.resolve([...context.entries.values()].filter(item => Object.entries(where).every(([key, value]) => item[key] === value))))
    context.prisma.reply.findUnique.mockImplementation(({ where }) => Promise.resolve([70, 71].includes(where.id) ? { id: where.id, entry_id: 50, user_id: 9, status: "published", created_at: new Date(where.id * 1000), published_at: new Date(where.id * 1000), user: { username: "Peer" } } : null))
    context.docs.set("Reply:70", { type: "doc", content: [paragraph("First")] })
    context.docs.set("Reply:71", { type: "doc", content: [paragraph("Second")] })
    return context
  }
  it("copies all card replies into one block, reports persisted state, and toggles off", async () => {
    const { service, entries, docs, uploads, prisma } = setup()
    expect(await service.toggleReplyKeep(7, 2, 50, [70, 71], true)).toEqual({ groups: [{ reply_ids: [70, 71] }] })
    expect(uploads.copyContentSnapshot.mock.calls.map(call => call[1])).toEqual([{ sourceType: "Reply", sourceId: 70 }, { sourceType: "Reply", sourceId: 71 }])
    expect(docs.get("Post:100")).toEqual({ type: "doc", content: [paragraph("First"), paragraph("Second")] })
    expect(entries.get(100).source_room_ids).toEqual([4])
    expect(await service.replyKeeps(7, 2, 50)).toEqual({ groups: [{ reply_ids: [70, 71] }] })
    expect(await service.toggleReplyKeep(7, 2, 50, [70, 71], false)).toEqual({ groups: [] })
    expect(entries.get(100).status).toBe("deleted")
    expect(entries.get(40).status).toBe("published")
    expect(prisma.reply.findUnique).toHaveBeenCalledTimes(2)
    expect(await service.toggleReplyKeep(7, 2, 50, [70, 71], true)).toEqual({ groups: [{ reply_ids: [70, 71] }] })
  })
  it("rejects a nonowner and replies from another discussion without creating a snapshot", async () => {
    const { service, prisma } = setup()
    await expect(service.toggleReplyKeep(7, 9, 50, [70], true)).rejects.toBeInstanceOf(NotFoundException)
    prisma.reply.findUnique.mockResolvedValue({ id: 70, entry_id: 99, user_id: 9, status: "published" })
    await expect(service.toggleReplyKeep(7, 2, 50, [70], true)).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.entry.create).not.toHaveBeenCalled()
  })
  it("rejects mixed authors and malformed reply sets", async () => {
    const { service, prisma } = setup()
    prisma.reply.findUnique.mockImplementation(({ where }) => Promise.resolve({ id: where.id, entry_id: 50, user_id: where.id, status: "published" }))
    await expect(service.toggleReplyKeep(7, 2, 50, [70, 71], true)).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.toggleReplyKeep(7, 2, 50, [70, 70], true)).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.entry.create).not.toHaveBeenCalled()
  })
})
