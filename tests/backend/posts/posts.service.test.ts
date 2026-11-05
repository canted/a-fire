import { EntriesReadService } from "@server/api/v1/entries/entries.read.service";
import { EntryNotificationsService } from "@server/api/v1/entries/entry-notifications.service";
import { parseContent } from "@server/api/v1/entries/post-content";
import { extractPlainText, trimTrailingBlankNodes } from "@server/realtime/document-content";
import { withTestDependencies } from "@tests/backend/helpers/service";
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { EntriesService } from "@server/api/v1/entries/entries.service";
import { vi } from "vitest";

const { capturePostPublishedMock, replyActivityMock } = vi.hoisted(() => ({
  capturePostPublishedMock: vi.fn(),
  replyActivityMock: vi.fn().mockResolvedValue([]),
}));

vi.mock("@server/api/v1/entries/room-reply-summary", () => ({ entryReplyRoundSummaries: replyActivityMock }));

vi.mock("@server/runtime/posthog", () => ({
  capturePosthogEvent: vi.fn(),
  capturePostPublished: capturePostPublishedMock,
}));

function draftPayloadFor(id: number, activityId?: number): Awaited<ReturnType<EntriesReadService["draftPayload"]>> {
  return {
    id, status: "draft", revision: 0, room_id: 2,
    round_id: activityId, project_id: undefined, source_entry_id: 80, project: null, round: null,
    content: { type: "doc", content: [] }, format: "mixed_media", format_data: {},
    subject: null, feedback_request: { reply_mode: "simple", requested_feedback_types: [], idea_guidance: null },
    feedback_request_customized: false, creation_origin: null,
    link_preview: null, user: { id: 1, username: "Writer", avatar_url: null },
  };
}

describe("PostsService", () => {
  beforeEach(() => {
    capturePostPublishedMock.mockClear();
    replyActivityMock.mockReset().mockResolvedValue([]);
  });

  const makeService = () => {
    const prisma = {
      square: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      roomMembership: { findMany: vi.fn(), findFirst: vi.fn() },
      entry: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), delete: vi.fn() },
      document: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
      entrySubject: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
      activeStorageBlob: { findMany: vi.fn().mockResolvedValue([]) },
      activeStorageAttachment: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      audioAsset: { findMany: vi.fn().mockResolvedValue([]) },
      roomStructureArchive: { findUnique: vi.fn().mockResolvedValue(null) },
      board: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
      room: { findUnique: vi.fn().mockResolvedValue({ reply_mode: "simple" }) },
      notificationEvent: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
      reflection: { findMany: vi.fn() },
      reply: { findMany: vi.fn(), count: vi.fn() },
      round: { findUnique: vi.fn() },
      activityArtifact: { findUnique: vi.fn() },
      activityParticipation: { update: vi.fn() },
      user: { findUnique: vi.fn() },
      videoAsset: { findMany: vi.fn().mockResolvedValue([]) },
      chatMessage: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
      chatMessageIdentityGrant: { createMany: vi.fn() },
      chatPresenceSession: { findMany: vi.fn().mockResolvedValue([]) },
      chatSaveRequest: { updateMany: vi.fn() },
      $transaction: vi.fn(), $queryRaw: vi.fn().mockResolvedValue([]),
    };
    prisma.$transaction.mockImplementation(async (callback: (client: typeof prisma) => unknown) => callback(prisma));
    const boss = { enqueue: vi.fn(), enqueueAfter: vi.fn(), enqueueInTransaction: vi.fn() };
    const realtime = {
      emit: vi.fn(),
      boardRoom: vi.fn().mockReturnValue("room"),
      chatRoom: vi.fn().mockReturnValue("chat-room"),
    };
    const boardsDetailService = { fetchBoard: vi.fn().mockResolvedValue({ squares: [] }) };
    const linkPreviews = {
      upsertAttachment: vi.fn().mockResolvedValue(null),
      prepareAttachment: vi.fn().mockResolvedValue(null),
      applyPreparedAttachment: vi.fn().mockResolvedValue(null),
      serializeAttachment: vi.fn().mockResolvedValue(null),
      attachmentsForOwners: vi.fn().mockResolvedValue(new Map()),
    };
    const activitiesService = {
      validateActivitySubmission: vi.fn(),
      markSubmitted: vi.fn(),
    };
    const circleAccess = withTestDependencies(new RoomAccessService(), { prisma });
    const circleAccessMock = {
      canReadPublishedPostWithRoomHistory: circleAccess.canReadPublishedPostWithRoomHistory.bind(circleAccess),
      require: vi.fn().mockResolvedValue({ kind: "member", canWriteWall: true }),
      requireMember: vi.fn().mockResolvedValue({ kind: "member", canWriteWall: true }),
      requireAccessesInTransaction: vi.fn().mockResolvedValue(new Map()),
      requireMemberInTransaction: vi.fn().mockResolvedValue({ kind: "member", canWriteWall: true }),
      resolve: vi.fn().mockResolvedValue({ kind: "member", canWriteWall: true }),
    };
    return withTestDependencies(new EntriesService(), {
      prisma,
      boss,
      realtime,
      boardsDetailService,
      linkPreviews,
      activitiesService,
      circleAccess: circleAccessMock,
      read: withTestDependencies(new EntriesReadService(), { prisma, linkPreviews, circleAccess: circleAccessMock }),
      notifications: withTestDependencies(new EntryNotificationsService(), { prisma, boss }),
    });
  };

  it("allows visitor deep links only to each member's current Entry and exposes published replies with visitor reply permission", async () => {
    const service = makeService();
    service.circleAccess.require.mockResolvedValue({ kind: "visitor", room: { id: 4, porosity: "masked" } });
    service.prisma.square.findUnique.mockResolvedValue({ user_id: 2, room_id: 4 });
    service.prisma.$queryRaw.mockResolvedValue([{ id: 40 }]);
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 12 });
    service.prisma.entry.findUnique.mockResolvedValue({
      id: 40,
      user_id: 2,
      room_id: 4,
      square_id: 30,
      status: "published",
      format: "mixed_media",
      format_data: { image_url: "/api/v1/uploads/114" },
      locked: false,
      created_at: new Date("2026-09-01T00:00:00Z"),
      published_at: new Date("2026-09-01T00:00:00Z"),
      square: { id: 30, board_id: 8, room_id: 4, current_entry_id: 40, room: { id: 4, name: "Circle" } },
      user: { id: 2, username: "Mira" },
      subject: null,
      project: null,
      project_id: null,
      round_id: null,
      reply_mode: "simple",
      requested_feedback_types: [],
      idea_guidance: null,
    });
    service.prisma.document.findFirst.mockResolvedValue(null);
    service.prisma.board.findUnique.mockResolvedValue({ id: 8, name: "Latest Posts" });
    service.prisma.reflection.findMany.mockResolvedValue([]);
    service.prisma.reply.findMany.mockResolvedValue([
      {
        id: 90,
        entry_id: 40,
        user_id: 3,
        status: "published",
        created_at: new Date("2026-09-02T00:00:00Z"),
        published_at: new Date("2026-09-02T00:00:00Z"),
        user: { id: 3, username: "Ada" },
        feedback_type: null,
      },
    ]);
    service.prisma.document.findMany.mockResolvedValue([]);
    service.prisma.roomMembership.findMany.mockResolvedValue([]);
    service.prisma.activeStorageAttachment.findFirst.mockResolvedValue(null);

    const result = await service.fetchEntry(40, 9);

    expect(result.replies.data.map((reply) => reply.id)).toEqual([90]);
    expect(result.entry.viewer_access).toEqual({ kind: "visitor", can_write: false, can_reply: true, can_withdraw: false });
    expect(result.entry.previous_entry).toBeNull();
    expect(result.entry.reflections).toEqual([]);
    expect(result.entry.format_data).toEqual({
      image_url: "/api/v1/uploads/114/variants/w1200",
    });

    service.prisma.entry.findUnique.mockResolvedValueOnce({
      ...(await service.prisma.entry.findUnique.mock.results[0]?.value),
      id: 39,
      square: { id: 30, board_id: 8, room_id: 4, current_entry_id: 40, room: { id: 4, name: "Circle" } },
    });
    await expect(service.fetchEntry(39, 9)).rejects.toBeInstanceOf(ForbiddenException);
    service.circleAccess.require.mockResolvedValue({ kind: "visitor", room: { id: 4, porosity: "open" } });
    service.prisma.entry.findUnique.mockResolvedValueOnce({
      ...(await service.prisma.entry.findUnique.mock.results[0]?.value), id: 39,
      square: { id: 30, board_id: 8, room_id: 4, current_entry_id: 40, room: { id: 4, name: "Circle" } },
    });
    await expect(service.fetchEntry(39, 9)).resolves.toMatchObject({ entry: { id: 39, viewer_access: { kind: "visitor" } } });

  });

  it("uses the latest published Entry for a limited visitor", async () => {
    const service = makeService();
    service.circleAccess.require.mockResolvedValue({ kind: "visitor", room: { id: 4, porosity: "masked" } });
    service.prisma.square.findUnique.mockResolvedValue({ user_id: 2, room_id: 4 });
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 12 });
    service.prisma.entry.findUnique.mockResolvedValueOnce({
      id: 40,
      user_id: 2,
      room_id: 4,
      square_id: 30,
      status: "published",
      format: "mixed_media",
      format_data: null,
      locked: false,
      created_at: new Date("2026-09-01T00:00:00Z"),
      published_at: new Date("2026-09-01T00:00:00Z"),
      square: { id: 30, board_id: 8, room_id: 4, current_entry_id: 99, room: { id: 4, name: "Circle" } },
      user: { id: 2, username: "Mira" },
      subject: null,
      project: null,
      project_id: null,
      round_id: null,
      reply_mode: "simple",
      requested_feedback_types: [],
      idea_guidance: null,
    }).mockResolvedValue({ user_id: 2, room_id: 4 });
    service.prisma.$queryRaw.mockResolvedValue([{ id: 40 }]);
    service.prisma.document.findFirst.mockResolvedValue(null);
    service.prisma.board.findUnique.mockResolvedValue({ id: 8, name: "Latest Posts" });
    service.prisma.reflection.findMany.mockResolvedValue([]);
    service.prisma.reply.findMany.mockResolvedValue([]);
    service.prisma.document.findMany.mockResolvedValue([]);
    service.prisma.roomMembership.findMany.mockResolvedValue([]);
    service.prisma.activeStorageAttachment.findFirst.mockResolvedValue(null);

    await expect(service.fetchEntry(40, 9)).resolves.toMatchObject({ entry: { id: 40 } });
  });

  it("does not let the saver edit a locked post owned by the original author", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({
      id: 40,
      user_id: 2,
      locked: true,
      square: { room_id: 2, user_id: 2 },
    });

    await expect(service.saveContent(40, 1, { type: "doc", content: [] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("routes the legacy delete transport through canonical Room withdrawal", async () => {
    const service = makeService();
    const result = { entry_id: 40, room_id: 4, current_entry_id: 39 };
    const withdraw = vi.spyOn(service, "withdrawRoomEntry").mockResolvedValue(result);
    expect(await service.deleteLockedChatPost(40, 2)).toEqual({ success: true, ...result });
    expect(withdraw).toHaveBeenCalledExactlyOnceWith(40, 2);
    expect(service.prisma.chatMessage.updateMany).not.toHaveBeenCalled();
    withdraw.mockRejectedValue(new ForbiddenException("Members only"));
    await expect(service.deleteLockedChatPost(40, 2)).rejects.toThrow("Members only");
  });

  it("does not expose a soft-deleted Chat-saved post through its detail URL", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({ id: 40, status: "deleted" });

    await expect(service.fetchEntry(40, 2)).rejects.toBeInstanceOf(NotFoundException);
    expect(service.circleAccess.require).not.toHaveBeenCalled();
  });

  it("forbids Room lists without membership", async () => {
    const service = makeService();
    service.circleAccess.requireMember.mockRejectedValue(new ForbiddenException("Members only"));

    await expect(service.listPosts(1, 2)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.prisma.entry.findMany).not.toHaveBeenCalled();
  });

  it("returns empty list when no memberships", async () => {
    const service = makeService();
    service.prisma.roomMembership.findMany.mockResolvedValue([]);

    const result = await service.listPosts(null, 2);

    expect(result).toEqual([]);
  });

  it("sorts listed Room entries by latest reply activity", async () => {
    const service = makeService();
    service.prisma.square.findFirst.mockResolvedValue({ id: 1 });
    service.prisma.board.findUnique.mockResolvedValue({ id: 1, room_id: 4 });
    service.prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 4 }]);
    service.prisma.entry.findMany.mockResolvedValue([
      {
        id: 10,
        room_id: 4,
        content: null,
        created_at: new Date("2026-06-10T12:00:00Z"),
        published_at: new Date("2026-06-10T12:00:00Z"),
        square: { board_id: 1 },
        user: { username: "Ada" },
      },
      {
        id: 11,
        room_id: 4,
        content: null,
        created_at: new Date("2026-06-12T12:00:00Z"),
        published_at: new Date("2026-06-12T12:00:00Z"),
        square: { board_id: 1 },
        user: { username: "Mara" },
      },
    ]);
    service.prisma.board.findMany.mockResolvedValue([{ id: 1, name: "Latest Posts" }]);
    service.prisma.document.findMany.mockResolvedValue([
      {
        docable_id: 10,
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Shared setup notes" }] }],
        },
      },
    ]);
    service.prisma.reply.findMany.mockResolvedValue([
      {
        entry_id: 10,
        created_at: new Date("2026-06-18T12:00:00Z"),
        published_at: new Date("2026-06-18T12:00:00Z"),
      },
      {
        entry_id: 10,
        created_at: new Date("2026-06-17T12:00:00Z"),
        published_at: new Date("2026-06-17T12:00:00Z"),
      },
    ]);

    replyActivityMock.mockResolvedValue([{ entry_id: 10, reply_count: 2n, latest_at: new Date("2026-06-18T12:00:00Z") }]);
    const result = await service.listPosts(1, 2);

    expect(result.map((post) => post.id)).toEqual(["10", "11"]);
    expect(result[0]).not.toHaveProperty("boardName");
    expect(service.prisma.reply.findMany).not.toHaveBeenCalled();
    expect(service.prisma.entry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 200, orderBy: [{ published_at: "desc" }, { created_at: "desc" }, { id: "desc" }],
    }));
    expect(service.prisma.board.findMany).not.toHaveBeenCalled();
    expect(result[0]).toEqual(
      expect.objectContaining({
        title: "Shared setup notes",
        activeAt: "2026-06-18T12:00:00.000Z",
        replyCount: 2,
        displayUsername: "Ada",
      }),
    );
  });

  it("labels textless media posts and includes display identity in list results", async () => {
    const service = makeService();
    service.prisma.square.findFirst.mockResolvedValue({ id: 1 });
    service.prisma.board.findUnique.mockResolvedValue({ id: 1, room_id: 5 });
    service.prisma.roomMembership.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          user_id: 7,
          room_id: 5,
          username_override: "Jordan",
          user: { username: "Jordan Default" },
        },
      ]);
    service.prisma.$queryRaw.mockResolvedValue([{ record_id: 7, blob_id: 33 }]);
    service.prisma.board.findMany.mockResolvedValue([{ id: 1, name: "Critique activities" }]);
    service.prisma.activeStorageAttachment.findMany.mockResolvedValue([
      { record_id: 12, blob_id: 44, active_storage_blobs: { filename: "garden-table.png" } },
    ]);
    service.prisma.audioAsset.findMany.mockResolvedValue([{ id: 50, source_id: 13, original_filename: "voice-note.m4a" }]);
    service.prisma.videoAsset.findMany.mockResolvedValue([{ id: 60, source_id: 14, original_filename: "walkthrough.mov" }]);
    service.prisma.entry.findMany.mockResolvedValue([
      {
        id: 12,
        user_id: 7,
        room_id: 5,
        content: JSON.stringify({
          type: "doc",
          content: [{ type: "image", attrs: { src: "/api/v1/uploads/44", alt: "Garden table" } }],
        }),
        created_at: new Date("2026-06-12T12:00:00Z"),
        published_at: new Date("2026-06-12T12:00:00Z"),
        square: { board_id: 1, room_id: 5 },
        user: { username: "Jordan Default" },
      },
      {
        id: 13,
        user_id: 7,
        room_id: 5,
        content: JSON.stringify({
          type: "doc",
          content: [{ type: "audio", attrs: { audioAssetId: 50, title: "Voice note", status: "ready" } }],
        }),
        created_at: new Date("2026-06-13T12:00:00Z"),
        published_at: new Date("2026-06-13T12:00:00Z"),
        square: { board_id: 1, room_id: 5 },
        user: { username: "Jordan Default" },
      },
      {
        id: 14,
        user_id: 7,
        room_id: 5,
        content: JSON.stringify({
          type: "doc",
          content: [{ type: "video", attrs: { videoAssetId: 60, title: "Walkthrough", status: "ready" } }],
        }),
        created_at: new Date("2026-06-14T12:00:00Z"),
        published_at: new Date("2026-06-14T12:00:00Z"),
        square: { board_id: 1, room_id: 5 },
        user: { username: "Jordan Default" },
      },
    ]);
    service.prisma.document.findMany.mockResolvedValue([
      { docable_id: 12, content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/44", alt: "Garden table" } }] } },
      { docable_id: 13, content: { type: "doc", content: [{ type: "audio", attrs: { audioAssetId: 50, title: "Voice note", status: "ready" } }] } },
      { docable_id: 14, content: { type: "doc", content: [{ type: "video", attrs: { videoAssetId: 60, title: "Walkthrough", status: "ready" } }] } },
    ]);
    service.prisma.reply.findMany.mockResolvedValue([]);

    const result = await service.listPosts(1, 2);

    const imagePost = result.find((post) => post.id === "12");
    const audioPost = result.find((post) => post.id === "13");
    const videoPost = result.find((post) => post.id === "14");

    expect(imagePost).toEqual(
      expect.objectContaining({
        id: "12",
        title: "Image - garden-table.png",
        mediaType: "image",
        displayUsername: "Jordan",
        displayAvatarUrl: "/api/v1/uploads/33/variants/avatarStripe40",
      }),
    );
    expect(audioPost).toEqual(
      expect.objectContaining({
        id: "13",
        title: "Audio - voice-note.m4a",
        mediaType: "audio",
      }),
    );
    expect(videoPost).toEqual(
      expect.objectContaining({
        id: "14",
        title: "Video - walkthrough.mov",
        mediaType: "video",
      }),
    );
  });

  it("parses and trims content helpers", () => {

    const parsed = parseContent("{\"type\":\"doc\",\"content\":[]}");
    expect(parsed).toEqual({ type: "doc", content: [] });

    const trimmed = trimTrailingBlankNodes({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hi" }] },
        { type: "paragraph", content: [{ type: "text", text: "" }] },
      ],
    });

    expect(trimmed).toEqual({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] });
  });

  it("fetches draft when authorized", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({ id: 5, user_id: 1, room_id: 2, source_entry_id: 80, project_id: null, status: "draft", format: "mixed_media", updated_at: new Date("2026-10-29T00:00:00Z") });
    const payloadSpy = vi.spyOn(service.read, "draftPayload").mockResolvedValue(draftPayloadFor(5));

    const result = await service.fetchDraft(5, 1);

    expect(payloadSpy).toHaveBeenCalledWith(5, 1);
    expect(result).toEqual(draftPayloadFor(5));
  });

  it("adds an eligible draft to the current activity without replacing the draft", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({
      id: 5,
      user_id: 1,
      room_id: 2, source_entry_id: 80, updated_at: new Date("2026-10-29T00:00:00Z"),
      status: "draft",
    });
    vi.spyOn(service as any, "syncDraftFeedbackRequest").mockResolvedValue(undefined);
    vi.spyOn(service.read, "draftPayload").mockResolvedValue(draftPayloadFor(5, 12));

    service.prisma.round.findUnique.mockResolvedValue({ id: 12, room_id: 2 });
    const result = await service.updateDraftActivity(5, 1, 12);

    expect((service as any).activitiesService.validateActivitySubmission).toHaveBeenCalledWith(12, 1, undefined, service.prisma);
    expect(service.prisma.entry.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { round_id: 12, updated_at: expect.any(Date) },
    });
    expect(result).toEqual(draftPayloadFor(5, 12));
  });

  it("removes activity context from a draft so it can be toggled back later", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({
      id: 5,
      user_id: 1,
      room_id: 2, source_entry_id: 80, updated_at: new Date("2026-10-29T00:00:00Z"),
      round_id: 12,
      status: "draft",
    });
    vi.spyOn(service as any, "syncDraftFeedbackRequest").mockResolvedValue(undefined);
    vi.spyOn(service.read, "draftPayload").mockResolvedValue(draftPayloadFor(5));

    await service.updateDraftActivity(5, 1, null);

    expect((service as any).activitiesService.validateActivitySubmission).not.toHaveBeenCalled();
    expect(service.prisma.entry.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { round_id: null, updated_at: expect.any(Date) },
    });
  });

  it("does not change activity context on a published post", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({
      id: 5,
      user_id: 1,
      room_id: 2, source_entry_id: 80, updated_at: new Date("2026-10-29T00:00:00Z"),
      status: "published",
    });

    await expect(service.updateDraftActivity(5, 1, 12)).rejects.toBeInstanceOf(BadRequestException);
    expect(service.prisma.entry.update).not.toHaveBeenCalled();
  });

  it("denies Round removal after Room membership is lost", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({ id: 5, user_id: 1, room_id: 2, source_entry_id: 80, status: "draft", updated_at: new Date() });
    service.circleAccess.requireMemberInTransaction.mockRejectedValue(new ForbiddenException("Members only"));
    await expect(service.updateDraftActivity(5, 1, null)).rejects.toThrow("Members only");
    expect(service.prisma.entry.update).not.toHaveBeenCalled();
  });

  it("rejects attaching a draft to another Room's Round", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({ id: 5, user_id: 1, room_id: 2, source_entry_id: 80, status: "draft", updated_at: new Date() });
    service.prisma.round.findUnique.mockResolvedValue({ id: 12, room_id: 3 });
    await expect(service.updateDraftActivity(5, 1, 12)).rejects.toThrow("another Room");
    expect(service.prisma.entry.update).not.toHaveBeenCalled();
  });

  it("rejects a Round change when the draft was published concurrently", async () => {
    const service = makeService();
    const draft = { id: 5, user_id: 1, room_id: 2, source_entry_id: 80, status: "draft", updated_at: new Date() };
    service.prisma.entry.findUnique.mockResolvedValueOnce(draft).mockResolvedValue({ ...draft, status: "published" });
    await expect(service.updateDraftActivity(5, 1, null)).rejects.toThrow("This Entry changed");
    expect(service.prisma.entry.update).not.toHaveBeenCalled();
  });

  it("saves content when authorized", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({ id: 5, user_id: 1, room_id: 2, source_entry_id: 80, project_id: null, status: "draft", format: "mixed_media", updated_at: new Date("2026-10-29T00:00:00Z") });
    const upsertSpy = vi.spyOn(service as any, "upsertDocument").mockResolvedValue(undefined);
    vi.spyOn(service.read, "draftPayload").mockResolvedValue(draftPayloadFor(5));

    const result = await service.saveContent(5, 1, { type: "doc" });

    expect(upsertSpy).toHaveBeenCalledWith("Post", 5, { type: "doc" }, service.prisma);
    expect(service.prisma.entrySubject.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entry_id: 5,
          subject_type: "plain_text",
        }),
      }),
    );
    expect(service.prisma.entry.update).toHaveBeenCalled();
    expect(result).toEqual(draftPayloadFor(5));
  });

  it("saves an explicit feedback request as customized", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({ id: 5, user_id: 1, room_id: 2, source_entry_id: 80, project_id: null, status: "draft", format: "mixed_media", updated_at: new Date("2026-10-29T00:00:00Z") });
    vi.spyOn(service as any, "upsertDocument").mockResolvedValue(undefined);
    vi.spyOn(service.read, "draftPayload").mockResolvedValue(draftPayloadFor(5));

    await service.saveContent(
      5,
      1,
      { type: "doc" },
      undefined,
      undefined,
      { reply_mode: "guided", requested_feedback_types: ["impression", "question"], idea_guidance: "craft" },
    );

    expect(service.prisma.entry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reply_mode: "guided",
          requested_feedback_types: ["impression", "question"],
          idea_guidance: "craft",
          feedback_request_customized: true,
        }),
      }),
    );
  });

  it("persists an explicit post subject when saving content", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({ id: 5, user_id: 1, room_id: 2, source_entry_id: 80, project_id: null, status: "draft", format: "mixed_media", updated_at: new Date("2026-10-29T00:00:00Z") });
    vi.spyOn(service as any, "upsertDocument").mockResolvedValue(undefined);
    vi.spyOn(service.read, "draftPayload").mockResolvedValue(draftPayloadFor(5));

    await service.saveContent(
      5,
      1,
      { type: "doc" },
      { type: "audio_asset", id: 12, key: "audio_asset:12", label: "Bridge idea", mode: "manual" },
    );

    expect(service.prisma.entrySubject.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entry_id: 5,
          subject_type: "audio_asset",
          subject_id: 12,
          subject_key: "audio_asset:12",
          metadata: expect.objectContaining({ label: "Bridge idea", mode: "manual" }),
        }),
      }),
    );
  });

  it("does not persist ordinary links as auto post subjects", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({ id: 5, user_id: 1, room_id: 2, source_entry_id: 80, project_id: null, status: "draft", format: "mixed_media", updated_at: new Date("2026-10-29T00:00:00Z") });
    vi.spyOn(service as any, "upsertDocument").mockResolvedValue(undefined);
    vi.spyOn(service.read, "draftPayload").mockResolvedValue(draftPayloadFor(5));

    await service.saveContent(5, 1, {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Session notes" }] },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "reference",
              marks: [{ type: "link", attrs: { href: "https://example.com/reference" } }],
            },
          ],
        },
        { type: "image", attrs: { src: "/cover.jpg", alt: "Cover" } },
      ],
    });

    expect(service.prisma.entrySubject.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entry_id: 5,
          subject_type: "image",
          subject_key: "/cover.jpg",
          metadata: expect.objectContaining({ label: "Cover" }),
        }),
      }),
    );
  });

  it("updates an existing post subject when saving content", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({ id: 5, user_id: 1, room_id: 2, source_entry_id: 80, project_id: null, status: "draft", format: "mixed_media", updated_at: new Date("2026-10-29T00:00:00Z") });
    service.prisma.entrySubject.findUnique.mockResolvedValue({ id: 99, entry_id: 5 });
    vi.spyOn(service as any, "upsertDocument").mockResolvedValue(undefined);
    vi.spyOn(service.read, "draftPayload").mockResolvedValue(draftPayloadFor(5));

    await service.saveContent(5, 1, { type: "doc", content: [{ type: "image", attrs: { src: "/cover.jpg" } }] });

    expect(service.prisma.entrySubject.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 99 },
        data: expect.objectContaining({
          subject_type: "image",
          subject_key: "/cover.jpg",
        }),
      }),
    );
  });

  it("rejects browser-local media URLs before saving post content", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({ id: 5, user_id: 1, room_id: 2, source_entry_id: 80, project_id: null, status: "draft", format: "mixed_media", updated_at: new Date("2026-10-29T00:00:00Z") });

    await expect(
      service.saveContent(5, 1, {
        type: "doc",
        content: [{ type: "image", attrs: { src: "blob:https://afire.app/local-image" } }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.prisma.document.create).not.toHaveBeenCalled();
    expect(service.prisma.entry.update).not.toHaveBeenCalled();
  });

  it("rejects empty entry publication without notifications or writes", async () => {
    const service = makeService();
    service.prisma.entry.findFirst.mockResolvedValue({ id: 80 });
    service.prisma.entry.findUnique.mockResolvedValue({ source_entry_id: 80, id: 5, user_id: 1, status: "draft", updated_at: new Date("2026-01-01T00:00:00Z"), room_id: 2 });
    service.prisma.document.findFirst.mockResolvedValue({ content: { type: "doc", content: [] } });
    await expect(service.publish(5, 1)).rejects.toThrow("Add a title");
    expect(service.prisma.document.create).not.toHaveBeenCalled();
    expect(service.prisma.notificationEvent.create).not.toHaveBeenCalled();
  });

  it("does not publish concealed activity contributions through the ordinary entry endpoint", async () => {
    const service = makeService();
    service.prisma.entry.findFirst.mockResolvedValue({ id: 80 });
    service.prisma.entry.findUnique.mockResolvedValue({ source_entry_id: 80, id: 5, user_id: 1, status: "draft", updated_at: new Date("2026-01-01T00:00:00Z"), round_id: 9, creation_origin: "round_activity_cover", room_id: 2 });
    service.prisma.round.findUnique.mockResolvedValue({ id: 9, template_key: "art_before_chorus" });
    service.prisma.document.findFirst.mockResolvedValue({ content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/42" } }] } });
    await expect(service.publish(5, 1)).rejects.toThrow("Activity step");
    expect(service.activitiesService.markSubmitted).not.toHaveBeenCalled();
    expect(service.prisma.notificationEvent.create).not.toHaveBeenCalled();
  });

  it("revalidates response content against settings changed during preparation", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({ id: 5, user_id: 1, source_entry_id: 80, status: "draft", round_id: 9, creation_origin: "round_activity_response", room_id: 2 });
    service.prisma.round.findUnique
      .mockResolvedValueOnce({ id: 9, template_key: "art_before_chorus", room_id: 2, template_config: { responseFormat: "audio_text" } })
      .mockResolvedValue({ id: 9, template_key: "art_before_chorus", room_id: 2, template_config: { responseFormat: "audio" } });
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Lyrics" }] }] };
    await expect(service.saveContent(5, 1, content, undefined, undefined, undefined, "mixed_media", {})).rejects.toThrow("audio only");
    expect(service.prisma.$transaction).toHaveBeenCalledOnce();
    expect(service.prisma.document.create).not.toHaveBeenCalled();
    expect(service.prisma.entry.update).not.toHaveBeenCalled();
  });

  it("rejects malformed phase content before draft mutation, including edits after artifact submission", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({ id: 5, user_id: 1, source_entry_id: 80, status: "draft", round_id: 9, creation_origin: "round_activity_cover", room_id: 2 });
    service.prisma.round.findUnique.mockResolvedValue({ id: 9, template_key: "art_before_chorus", room_id: 4 });
    service.prisma.activityArtifact.findUnique.mockResolvedValue({ status: "active" });
    await expect(service.saveContent(5, 1, { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/42" } }, { type: "paragraph", content: [{ type: "text", text: "Hidden text" }] }] }, undefined, undefined, undefined, "mixed_media", {})).rejects.toThrow("images only");
    await expect(service.saveContent(5, 1, { type: "doc", content: [] }, undefined, undefined, undefined, "mixed_media", {})).rejects.toThrow("Add a title");
    expect(service.prisma.document.create).not.toHaveBeenCalled();
    expect(service.prisma.document.update).not.toHaveBeenCalled();
  });

  it("publishes and enqueues notifications", async () => {
    const service = makeService();
    service.prisma.entry.findFirst.mockResolvedValue({ id: 80 });
    service.prisma.entry.findUnique.mockResolvedValue({ updated_at: new Date("2026-10-29T00:00:00Z"), source_entry_id: 80, format_data: { title: "Entry title" },
      id: 5,
      user_id: 1,
      square_id: 3,
      published_at: null,
      room_id: 2,
    });
    service.prisma.document.findFirst.mockResolvedValue({ content: { type: "doc", content: [] } });
    service.prisma.notificationEvent.create.mockResolvedValue({ id: 7 });

    const payloadSpy = vi.spyOn(service.read, "draftPayload").mockResolvedValue(draftPayloadFor(5));

    const result = await service.publish(5, 1);

    expect(service.prisma.entry.update).toHaveBeenCalled();
    expect(service.prisma.square.update).not.toHaveBeenCalled();
    expect(service.prisma.entrySubject.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entry_id: 5,
          subject_type: "plain_text",
        }),
      }),
    );
    expect(service.boss.enqueueInTransaction).toHaveBeenCalledWith(service.prisma, "notifications.fanout", { eventId: 7 });
    expect(service.realtime.emit).toHaveBeenCalled();
    expect(capturePostPublishedMock).toHaveBeenCalledWith({
      userId: 1,
      entryId: 5,
      roomId: 2,
      activityId: undefined,
      projectId: undefined,
      sourceEntryId: 80,
      content: { type: "doc", content: [] },
    });
    expect(payloadSpy).toHaveBeenCalledWith(5, 1);
    expect(result).toEqual(draftPayloadFor(5));
  });

  it("marks activity participation submitted when publishing a activity draft", async () => {
    const service = makeService();
    service.prisma.entry.findFirst.mockResolvedValue({ id: 80 });
    service.prisma.entry.findUnique.mockResolvedValue({ updated_at: new Date("2026-10-29T00:00:00Z"), source_entry_id: 80, format_data: { title: "Entry title" },
      id: 5,
      user_id: 1,
      square_id: 3,
      round_id: 12,
      status: "draft",
      reply_mode: "simple",
      requested_feedback_types: [],
      feedback_request_customized: true,
      published_at: null,
      room_id: 2,
    });
    service.prisma.document.findFirst.mockResolvedValue({ content: { type: "doc", content: [] } });
    service.prisma.notificationEvent.create.mockResolvedValue({ id: 7 });
    vi.spyOn(service.read, "draftPayload").mockResolvedValue(draftPayloadFor(5, 12));

    service.prisma.round.findUnique.mockResolvedValue({ id: 9, template_key: "feedback" });
    await service.publish(5, 1);

    expect((service as any).activitiesService.validateActivitySubmission).toHaveBeenCalledWith(12, 1);
    expect((service as any).activitiesService.markSubmitted).toHaveBeenCalledWith(12, 5, 1, service.prisma);
  });

  it("rejects publishing guided posts with no requested feedback types", async () => {
    const service = makeService();
    service.prisma.entry.findFirst.mockResolvedValue({ id: 80 });
    service.prisma.entry.findUnique.mockResolvedValue({ source_entry_id: 80,
      id: 5,
      user_id: 1,
      square_id: 3,
      status: "draft",
      reply_mode: "guided",
      requested_feedback_types: [],
      feedback_request_customized: true,
      room_id: 2,
    });

    await expect(service.publish(5, 1)).rejects.toBeInstanceOf(BadRequestException);

    expect(service.prisma.document.findFirst).not.toHaveBeenCalled();
  });

  it("creates targeted mention notifications for mentioned users when publishing", async () => {
    const service = makeService();
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    Object.assign(service.prisma, { page: { findFirst: vi.fn().mockResolvedValue({ room_id: 2 }) } });
    Object.assign(service.circleAccess, { resolve: vi.fn().mockResolvedValue({ kind: "member", canWriteWall: true, canViewNotes: true }) });
    service.prisma.entry.findFirst.mockResolvedValue({ id: 80 });
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello" },
            { type: "mention", attrs: { id: "user:2", targetType: "user", targetId: "2", label: "Ada" } },
            { type: "mention", attrs: { id: "page:4", targetType: "note", targetId: "4", label: "Roadmap" } },
            { type: "mention", attrs: { id: "user:1", targetType: "user", targetId: "1", label: "Me" } },
          ],
        },
      ],
    };
    service.prisma.entry.findUnique.mockResolvedValue({ updated_at: new Date("2026-10-29T00:00:00Z"), source_entry_id: 80,
      id: 5,
      user_id: 1,
      square_id: 3,
      published_at: null,
      room_id: 2,
    });
    service.prisma.document.findFirst.mockResolvedValue({ content });
    service.prisma.roomMembership.findMany.mockResolvedValue([{ user_id: 2 }]);
    service.prisma.notificationEvent.create.mockResolvedValueOnce({ id: 7 }).mockResolvedValueOnce({ id: 8 });
    vi.spyOn(service.read, "draftPayload").mockResolvedValue(draftPayloadFor(5));

    await service.publish(5, 1);

    expect(service.prisma.roomMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ room_id: 2, user_id: { in: [2] }, disabled: false }),
      }),
    );
    expect(service.prisma.notificationEvent.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: "mention",
          actor_id: 1,
          room_id: 2,
          entry_id: 5,
          target_user_id: 2,
          payload: { excerpt: "Hello" },
          target_path: "/app/entries/5",
        }),
      }),
    );
    expect(service.boss.enqueueInTransaction).toHaveBeenCalledWith(service.prisma, "notifications.fanout", { eventId: 7 });
    expect(service.boss.enqueueInTransaction).toHaveBeenCalledWith(service.prisma, "notifications.fanout", { eventId: 8 });
  });

  it("fetches post with replies and pagination", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({
      id: 5,
      status: "published",
      room_id: 2,
      square_id: 3,
      user_id: 1,
      created_at: new Date("2024-01-01T00:00:00Z"),
      published_at: new Date("2024-01-01T00:00:00Z"),
      user: { id: 1, username: "u1" },
      square: { board_id: 9, room_id: 2, room: { id: 2, name: "Evening Circle" } },
      round_id: 8,
      round: { id: 8, name: "Sleeve Exchange", board_id: 9 },
      content: null,
      subject: {
        subject_type: "audio_asset",
        subject_id: 41,
        subject_key: "audio_asset:41",
        source_node_id: "node-1",
        metadata: { label: "Bridge idea", mode: "manual", preview: { title: "Bridge idea" } },
      },
    });
    service.prisma.room.findUnique.mockResolvedValue({ id: 2, name: "Evening Circle" });
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    service.prisma.board.findUnique.mockResolvedValue({ id: 9, name: "Latest Posts" });
    service.prisma.document.findFirst.mockResolvedValue({ content: { type: "doc", content: [] } });
    service.prisma.reflection.findMany.mockResolvedValue([
      { page_id: 1, user_id: 1, page: { title: "T", icon: "I" } },
    ]);
    service.prisma.reply.findMany.mockResolvedValue([
      {
        id: 10,
        status: "published",
        created_at: new Date("2024-01-01T00:00:01Z"),
        published_at: new Date("2024-01-01T00:00:02Z"),
        user_id: 2,
        user: { id: 2, username: "u2" },
      },
      {
        id: 11,
        status: "published",
        created_at: new Date("2024-01-01T00:00:03Z"),
        published_at: new Date("2024-01-01T00:00:03Z"),
        user_id: 3,
        user: { id: 3, username: "u3" },
      },
    ]);
    service.prisma.document.findMany.mockResolvedValue([{ docable_id: 10, content: { type: "doc", content: [] } }]);
    service.prisma.roomMembership.findMany.mockResolvedValue([
      { user_id: 1, username_override: null, user: { username: "u1" } },
      { user_id: 2, username_override: "alt", user: { username: "u2" } },
    ]);
    service.prisma.$queryRaw.mockResolvedValue([{ record_id: 1, blob_id: "user-1-avatar" }, { record_id: 2, blob_id: "user-2-avatar" }]);
    service.prisma.activeStorageAttachment.findFirst.mockResolvedValue({ blob_id: "community-avatar" });
    service.prisma.entry.findFirst
      .mockResolvedValueOnce({ id: 4, status: "published", room_id: 2, created_at: new Date("2023-12-01T00:00:00Z"), published_at: new Date("2023-12-01T00:00:00Z") })
      .mockResolvedValueOnce({ id: 6, status: "published", room_id: 2, created_at: new Date("2024-02-01T00:00:00Z"), published_at: new Date("2024-02-01T00:00:00Z") })
      .mockResolvedValueOnce({ id: 3, status: "published", room_id: 2, created_at: new Date("2023-11-01T00:00:00Z"), published_at: new Date("2023-11-01T00:00:00Z") })
      .mockResolvedValueOnce({ id: 7, status: "published", room_id: 2, created_at: new Date("2024-03-01T00:00:00Z"), published_at: new Date("2024-03-01T00:00:00Z") });

    const result = await service.fetchEntry(5, 1, "1", "1");

    expect(service.prisma.reply.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ published_at: "asc" }, { id: "asc" }],
        skip: 0,
        take: 2,
      }),
    );
    expect(service.prisma.reply.count).not.toHaveBeenCalled();
    expect(result.entry.user.display_username).toBe("u1");
    expect(result.entry.subject).toEqual({
      type: "audio_asset",
      id: 41,
      key: "audio_asset:41",
      sourceNodeId: "node-1",
      label: "Bridge idea",
      preview: { title: "Bridge idea" },
      mode: "manual",
    });
    expect(result.entry.display_avatar_url).toBe("/api/v1/uploads/user-1-avatar");
    expect(result.entry).not.toHaveProperty("board");
    expect(result.entry.room).toEqual({
      id: 2,
      name: "Evening Circle",
      avatar_url: "/api/v1/uploads/community-avatar",
    });
    expect(result.entry.round).toEqual({ id: 8, name: "Sleeve Exchange" });
    expect(result.entry.previous_round_entry?.id).toBe(3);
    expect(result.entry.next_round_entry?.id).toBe(7);
    expect(result.replies.data[0].display_username).toBe("alt");
    expect(result.replies.data[0].display_avatar_url).toBe("/api/v1/uploads/user-2-avatar");
    expect(result.replies.pagination.next_page).toBe(2);
  });

  it("throws when post not found", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue(null);
    await expect(service.fetchEntry(5, 1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns null for invalid parse", () => {
    expect(parseContent("bad")).toBeNull();
  });

  it("extracts plain text from nested nodes", () => {
    const text = extractPlainText({
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
        { type: "paragraph", content: [{ type: "text", text: "World" }] },
      ],
    });
    expect(text).toBe("Hello World");
  });
  it("rejects a Room draft without a private source before any publication writes", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({ id: 5, user_id: 1, status: "draft", room_id: 2, format_data: { title: "Existing work" } });
    await expect(service.publish(5, 1)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.prisma.entry.update).not.toHaveBeenCalled();
    expect(service.prisma.document.create).not.toHaveBeenCalled();
    expect(service.prisma.notificationEvent.create).not.toHaveBeenCalled();
  });
  it("rejects inherited feedback from another Room before publication", async () => {
    const service = makeService();
    service.prisma.entry.findFirst.mockResolvedValue({ id: 80 });
    service.prisma.entry.findUnique.mockResolvedValue({ id: 5, source_entry_id: 80, user_id: 1, status: "draft", feedback_request_customized: true, room_id: 2, source_room_ids: [3], format_data: { title: "Work" } });
    service.prisma.document.findFirst.mockResolvedValue({ content: { type: "doc", content: [] } });
    await expect(service.publish(5, 1)).rejects.toThrow("original room");
    expect(service.prisma.entry.update).not.toHaveBeenCalled();
    expect(service.prisma.notificationEvent.create).not.toHaveBeenCalled();
  });

});
