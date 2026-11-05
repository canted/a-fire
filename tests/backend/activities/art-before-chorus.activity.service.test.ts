import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ArtBeforeChorusRoundService } from "@server/api/v1/rounds/runtime/art-before-chorus.activity.service";
import { withTestDependencies } from "@tests/backend/helpers/service";
import { vi } from "vitest";

vi.mock("@server/api/v1/rounds/publish-round-wall", () => ({ publishRoundWall: vi.fn(), lockRound: vi.fn() }));

const activity = (overrides: Record<string, unknown> = {}) => ({
  id: 9,
  name: "Sleeve Exchange",
  board_id: 3,
  room_id: 4,
  host_id: 1,
  status: "active",
  template_key: "art_before_chorus",
  template_config: { responseFormat: "audio_text", sketchSize: "tiny" },
  submit_by: new Date(Date.now() + 60_000),
  feedback_due_at: new Date(Date.now() + 120_000),
  closed_at: null,
  ...overrides,
});

function makeService() {
  const prisma = {
    round: { findUniqueOrThrow: vi.fn().mockImplementation(async () => activity()), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    activityParticipation: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    activitySubmission: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    activityArtifact: {
      count: vi.fn().mockResolvedValue(3),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    activityOffer: { upsert: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    activityModerationEvent: { create: vi.fn() },
    entry: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    square: { update: vi.fn(), findUnique: vi.fn().mockResolvedValue({ user_id: 2, room_id: 4, board_id: 1 }) },
    board: { findUnique: vi.fn().mockResolvedValue({ room_id: 4 }) },
    document: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    chatMessage: { upsert: vi.fn() },
    notificationEvent: { create: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  };
  prisma.$transaction.mockImplementation((callback) => callback(prisma));
  return withTestDependencies(new ArtBeforeChorusRoundService(), {
    prisma,
    circleAccess: { resolve: vi.fn().mockResolvedValue({ kind: "member" }), requireMemberInTransaction: vi.fn().mockResolvedValue({ canManage: true }) },
    boss: { enqueue: vi.fn(), enqueueInTransaction: vi.fn() },
  });
}

describe("ArtBeforeChorusActivityService", () => {
  it("rechecks the deadline under the Round lock before automatic finalization", async () => {
    const service = makeService();
    vi.spyOn(service, "syncChat").mockResolvedValue([]);
    service.prisma.round.findUnique
      .mockResolvedValueOnce(activity({ feedback_due_at: new Date(Date.now() - 60_000) }))
      .mockResolvedValue(activity({ feedback_due_at: new Date(Date.now() + 60_000) }));
    await service.finalize(9);
    expect(service.prisma.round.updateMany).not.toHaveBeenCalled();
    expect(service.prisma.entry.updateMany).not.toHaveBeenCalled();
  });

  it("limits visitor results to published Room artifacts and omits personal offers", async () => {
    const service = makeService();
    service.prisma.activityParticipation.findMany.mockResolvedValue([]);
    const cover = { id: 10, kind: "cover", entry_id: 20, user_id: 7, entry: { status: "published", room_id: 4, format_data: { image_url: "/cover.png" } }, user: { username: "Cover author" } };
    const response = { id: 11, kind: "response", entry_id: 21, user_id: 7, source_artifact_id: 10, entry: { status: "published", room_id: 4, format: "mixed_media", format_data: null }, user: { username: "Responder" } };
    service.prisma.activityArtifact.findMany.mockResolvedValue([
      cover, response,
      { ...response, id: 12, entry_id: 22, entry: { ...response.entry, status: "deleted" } },
      { ...response, id: 13, entry_id: 23, entry: { ...response.entry, project_id: 5 } },
      { ...response, id: 14, entry_id: 24, entry: { ...response.entry, room_id: 8 } },
    ]);
    service.prisma.document.findMany.mockResolvedValue([]);
    const result = await service.detail(activity({ status: "archived", closed_at: new Date() }) as never, 7, "visitor");
    expect(result.results).toHaveLength(1);
    expect(result.viewer).toEqual({});
    expect(result.isHost).toBe(false);
    expect(service.prisma.activityOffer.findUnique).not.toHaveBeenCalled();
    expect(service.prisma.document.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { docable_type: "Post", docable_id: { in: [20, 21] } } }));
  });

  it("retains explicit shared context in revealed responses without revealing it before completion", async () => {
    const service = makeService();
    service.prisma.activityParticipation.findMany.mockResolvedValue([]);
    service.prisma.activityOffer.findUnique.mockResolvedValue(null);
    service.prisma.activityArtifact.findMany.mockResolvedValue([
      { id: 10, kind: "cover", entry_id: 20, user_id: 2, entry: { room_id: 4, format_data: { image_url: "/cover.png" } }, user: { username: "Cover author" } },
      { id: 11, kind: "response", entry_id: 21, user_id: 3, source_artifact_id: 10,
        entry: { room_id: 4, format: "mixed_media", format_data: null, room_statement: "A response to this cover", shared_feedback: [{ source_room_id: 4, author_name: "Maya", content: { type: "doc", content: [] }, private_record_id: 99 }] }, user: { username: "Responder" } },
    ]);
    service.prisma.document.findMany.mockResolvedValue([]);
    const before = await service.detail(activity() as never, 7, "member");
    expect(before.results).toEqual([]);
    expect(before.viewer.response).toBeUndefined();
    const after = await service.detail(activity({ closed_at: new Date() }) as never, 7, "member");
    expect(after.results[0].response.room_statement).toBe("A response to this cover");
    expect(after.results[0].response.shared_feedback).toEqual([expect.objectContaining({ author_name: "Maya", source_room_id: 4 })]);
    expect(after.results[0].response.shared_feedback?.[0]).not.toHaveProperty("private_record_id");
  });

  it("uses the two dates as cover, response, and reveal boundaries", () => {
    const service = makeService();
    const now = new Date("2026-09-10T12:00:00Z");
    expect(service.phase(activity({ submit_by: new Date("2026-09-11T12:00:00Z") }) as never, now)).toBe("collecting_covers");
    expect(service.phase(activity({ submit_by: new Date("2026-09-09T12:00:00Z"), feedback_due_at: new Date("2026-09-11T12:00:00Z") }) as never, now)).toBe("collecting_responses");
    expect(service.phase(activity({ submit_by: new Date("2026-09-08T12:00:00Z"), feedback_due_at: now }) as never, now)).toBe("complete");
  });

  it("keeps accepting covers after the scheduled cover time until three are in", async () => {
    const service = makeService();
    service.prisma.activityArtifact.count.mockResolvedValue(2);
    service.prisma.activityParticipation.findFirst.mockResolvedValue({ id: 20, room_id: 4 });

    await expect(
      service.validateDraft(
        activity({ submit_by: new Date(Date.now() - 60_000) }) as never,
        2,
        "round_activity_cover",
      ),
    ).resolves.toEqual(expect.objectContaining({ participation: expect.objectContaining({ id: 20 }) }));
  });

  it("persists the database-selected pair without loading all covers or offers", async () => {
    const service = makeService();
    service.prisma.activityParticipation.findFirst.mockResolvedValue({ id: 20, room_id: 4 });
    service.prisma.activityArtifact.findUnique.mockResolvedValue({ id: 100, status: "active" });
    service.prisma.activityOffer.findUnique.mockResolvedValue(null);
    service.prisma.$queryRaw.mockResolvedValue([{ id: 102 }, { id: 103 }]);
    service.prisma.activityOffer.upsert.mockResolvedValue({
      id: 40,
      round_id: 9,
      user_id: 2,
      first_artifact_id: 102,
      second_artifact_id: 103,
      chosen_artifact_id: null,
    });

    await service.prepareForDetail(
      activity({ submit_by: new Date(Date.now() - 60_000) }) as never,
      2,
      "member",
    );

    expect(service.prisma.activityArtifact.findMany).not.toHaveBeenCalled();
    expect(service.prisma.activityOffer.findMany).not.toHaveBeenCalled();
    const offerData = service.prisma.activityOffer.upsert.mock.calls[0][0].create;
    expect(new Set([offerData.first_artifact_id, offerData.second_artifact_id])).toEqual(new Set([102, 103]));
    expect(offerData.user_id).toBe(2);
  });

  it("requires a chosen offered cover before accepting a response draft", async () => {
    const service = makeService();
    service.prisma.activityParticipation.findFirst.mockResolvedValue({ id: 20, room_id: 4 });
    service.prisma.activityOffer.findUnique.mockResolvedValue(null);

    await expect(
      service.validateDraft(
        activity({ submit_by: new Date(Date.now() - 60_000) }) as never,
        2,
        "round_activity_response",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("shows the host which participants have moved from choosing to making", async () => {
    const service = makeService();
    service.prisma.activityParticipation.findMany.mockResolvedValue([
      { id: 20, user_id: 2, user: { username: "Maya" } },
      { id: 21, user_id: 3, user: { username: "Theo" } },
    ]);
    service.prisma.activityArtifact.findMany.mockResolvedValue([
      { id: 100, kind: "cover", user_id: 2, entry_id: 30, entry: { room_id: 4, format_data: { image_url: "/maya.jpg" } }, user: { username: "Maya" } },
      { id: 101, kind: "cover", user_id: 3, entry_id: 31, entry: { room_id: 4, format_data: { image_url: "/theo.jpg" } }, user: { username: "Theo" } },
    ]);
    service.prisma.document.findMany.mockResolvedValue([]);
    service.prisma.activityOffer.findUnique.mockResolvedValue(null);
    service.prisma.activityOffer.findMany.mockResolvedValue([
      { user_id: 2, first_artifact_id: 101, second_artifact_id: 101, chosen_artifact_id: 101 },
      { user_id: 3, first_artifact_id: 100, second_artifact_id: 100, chosen_artifact_id: null },
    ]);

    const result = await service.detail(
      activity({ submit_by: new Date(Date.now() - 60_000) }) as never,
      1,
      "member",
    );

    expect(result.participants).toEqual([
      expect.objectContaining({ name: "Maya", responseStatus: "making" }),
      expect.objectContaining({ name: "Theo", responseStatus: "choosing" }),
    ]);
  });

  it.each([undefined, "", "   "])("gives untitled cover entries meaningful alternative text (%s)", async title => {
    const service = makeService();
    service.prisma.activityParticipation.findMany.mockResolvedValue([]);
    service.prisma.activityArtifact.findMany.mockResolvedValue([
      { id: 100, kind: "cover", user_id: 2, entry_id: 30, entry: { room_id: 4, format: "mixed_media", format_data: { title, image_url: "/api/v1/uploads/42" } }, user: { username: "Maya" } },
    ]);
    service.prisma.document.findMany.mockResolvedValue([{ docable_id: 30, content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/42" } }] } }]);
    service.prisma.activityOffer.findUnique.mockResolvedValue(null);

    const result = await service.detail(activity() as never, 2, "member");

    expect(result.viewer.cover).toMatchObject({ alt: "Cover art", imageUrl: "/api/v1/uploads/42/variants/w1200" });
  });

  it("uses document images for own, offered, chosen, participant and revealed covers", async () => {
    const service = makeService();
    service.prisma.activityParticipation.findMany.mockResolvedValue([
      { id: 20, user_id: 2, user: { username: "Maya" } },
    ]);
    service.prisma.activityArtifact.findMany.mockResolvedValue([
      { id: 100, kind: "cover", user_id: 2, entry_id: 30, entry: { room_id: 4, format: "mixed_media", format_data: null }, user: { username: "Maya" } },
      { id: 101, kind: "response", user_id: 3, entry_id: 31, source_artifact_id: 100, entry: { room_id: 4, format: "mixed_media", format_data: null }, user: { username: "Theo" } },
    ]);
    service.prisma.document.findMany.mockResolvedValue([
      { docable_id: 30, content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/42" } }] } },
    ]);
    service.prisma.activityOffer.findUnique.mockResolvedValue({ first_artifact_id: 100, second_artifact_id: 100, chosen_artifact_id: 100 });
    const result = await service.detail(activity({ status: "archived", closed_at: new Date() }) as never, 2, "member");
    const expected = { imageUrl: "/api/v1/uploads/42/variants/w1200", alt: "Cover art" };
    expect(result.viewer.cover).toMatchObject(expected);
    expect(result.viewer.chosenCover).toMatchObject(expected);
    expect(result.viewer.offeredCovers).toEqual([expect.objectContaining(expected), expect.objectContaining(expected)]);
    expect(result.participants[0].cover).toMatchObject(expected);
    expect(result.results[0].cover).toMatchObject(expected);
  });

  it("rejects a contribution draft owned by another participant", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({
      id: 30,
      user_id: 7,
      round_id: 9,
      status: "draft",
      creation_origin: "round_activity_cover",
      room_id: 4,
      square: { user_id: 7 },
    });

    await expect(service.submitArtifact(activity() as never, 2, { kind: "cover", entryId: 30 })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("associates the chosen cover without rewriting the submitted response Document", async () => {
    const service = makeService();
    service.prisma.entry.findFirst.mockResolvedValue({ id: 80 });
    const responseActivity = activity({ submit_by: new Date(Date.now() - 60_000) });
    service.prisma.entry.findUnique.mockResolvedValue({ source_entry_id: 80,
      id: 31,
      user_id: 2,
      round_id: 9,
      status: "draft",
      format: "mixed_media",
      format_data: { name: "Bright rising tones", audio_asset_id: 41 },
      creation_origin: "round_activity_response",
      room_id: 4,
      square: { user_id: 2 },
    });
    service.prisma.activityParticipation.findFirst.mockResolvedValue({ id: 20, room_id: 4 });
    service.prisma.activityOffer.findUnique.mockResolvedValue({ chosen_artifact_id: 51 });
    service.prisma.activityArtifact.findUnique.mockResolvedValue({
      id: 51,
      round_id: 9,
      kind: "cover",
      status: "active",
      entry: { format_data: { image_url: "/api/v1/uploads/163" } },
    });
    service.prisma.document.findUnique.mockResolvedValue({
      content: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Bright rising tones" }] },
          { type: "audio", attrs: { audioAssetId: 41, title: "Bright rising tones", status: "ready" } },
        ],
      },
    });
    service.prisma.activityArtifact.upsert.mockResolvedValue({ id: 61, kind: "response", submitted_at: new Date() });

    await service.submitArtifact(responseActivity as never, 2, { kind: "response", entryId: 31 });

    expect(service.prisma.document.upsert).not.toHaveBeenCalled();
    expect(service.prisma.activityArtifact.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ entry_id: 31, source_artifact_id: 51, kind: "response" }),
    }));
  });

  it("submits a mixed-media image-only entry without changing its stored format or private source", async () => {
    const service = makeService();
    service.prisma.entry.findFirst.mockResolvedValue({ id: 80 });
    service.prisma.entry.findUnique.mockResolvedValue({ id: 30, user_id: 2, round_id: 9, status: "draft", creation_origin: "round_activity_cover", room_id: 4, source_entry_id: 80, format: "mixed_media", format_data: {} });
    service.prisma.activityParticipation.findFirst.mockResolvedValue({ id: 20, room_id: 4 });
    service.prisma.document.findUnique.mockResolvedValue({ content: { type: "doc", content: [{ type: "paragraph", content: [] }, { type: "image", attrs: { src: "/api/v1/uploads/42" } }] } });
    service.prisma.activityArtifact.upsert.mockResolvedValue({ id: 51, kind: "cover", submitted_at: new Date() });
    await service.submitArtifact(activity() as never, 2, { kind: "cover", entryId: 30 });
    expect(service.prisma.entry.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 30 }, data: expect.objectContaining({ format: "mixed_media", format_data: { image_url: "/api/v1/uploads/42" } }) }));
    expect(service.prisma.document.upsert).not.toHaveBeenCalled();
  });

  it.each([
    { type: "paragraph", content: [{ type: "text", text: "Caption outside the selected format" }] },
    { type: "audio", attrs: { audioAssetId: 6 } },
  ])("rejects disallowed document content even when metadata claims an image format", async node => {
    const service = makeService();
    service.prisma.entry.findFirst.mockResolvedValue({ id: 80 });
    service.prisma.entry.findUnique.mockResolvedValue({ source_entry_id: 80, id: 30, user_id: 2, round_id: 9, status: "draft", creation_origin: "round_activity_cover", room_id: 4, format: "mixed_media", format_data: { image_url: "/api/v1/uploads/42" } });
    service.prisma.activityParticipation.findFirst.mockResolvedValue({ id: 20, room_id: 4 });
    service.prisma.document.findUnique.mockResolvedValue({ content: { type: "doc", content: [node] } });
    await expect(service.submitArtifact(activity() as never, 2, { kind: "cover", entryId: 30 })).rejects.toThrow("images only");
    expect(service.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("submits a text-and-audio entry through the same phase path", async () => {
    const service = makeService();
    service.prisma.entry.findFirst.mockResolvedValue({ id: 80 });
    service.prisma.entry.findUnique.mockResolvedValue({ source_entry_id: 80, id: 31, user_id: 2, round_id: 9, status: "draft", creation_origin: "round_activity_response", room_id: 4, format: "mixed_media", format_data: { title: "A small sketch" } });
    service.prisma.activityParticipation.findFirst.mockResolvedValue({ id: 20, room_id: 4 });
    service.prisma.activityOffer.findUnique.mockResolvedValue({ chosen_artifact_id: 51 });
    service.prisma.activityArtifact.findUnique.mockResolvedValue({ id: 51, status: "active", kind: "cover", round_id: 9, entry: { format_data: { image_url: "/api/v1/uploads/42" } } });
    service.prisma.document.findUnique.mockResolvedValue({ content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Two lines of lyrics" }] }, { type: "audio", attrs: { audioAssetId: 6 } }] } });
    service.prisma.activityArtifact.upsert.mockResolvedValue({ id: 61, kind: "response", submitted_at: new Date() });
    await service.submitArtifact(activity({ submit_by: new Date(Date.now() - 60_000) }) as never, 2, { kind: "response", entryId: 31 });
    expect(service.prisma.activityArtifact.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ entry_id: 31, source_artifact_id: 51, kind: "response" }) }));
    expect(service.prisma.document.upsert).not.toHaveBeenCalled();
  });

  it("records cover removal, its note, and the requested notification", async () => {
    const service = makeService();
    service.prisma.activityArtifact.findFirst.mockResolvedValue({ id: 50, round_id: 9, user_id: 2, entry_id: 30 });
    service.prisma.notificationEvent.create.mockResolvedValue({ id: 70 });

    await expect(
      service.removeCover(activity() as never, 1, {
        artifactId: 50,
        note: "Please choose a different image.",
        sendPushNotification: true,
      }),
    ).resolves.toEqual({ removed: true, notificationStatus: "queued" });

    expect(service.prisma.activityModerationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        artifact_id: 50,
        note: "Please choose a different image.",
        notification_requested: true,
        notification_status: "queued",
      }),
    });
    expect(service.prisma.notificationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: "round_contribution_removed",
        target_path: "/app/rounds/9",
        payload: expect.objectContaining({ activity_name: "Sleeve Exchange" }),
      }),
    });
    expect(service.boss.enqueueInTransaction).toHaveBeenCalledWith(service.prisma, "notifications.fanout", { eventId: 70 });
  });

  it("publishes completed responses to the Wall with cover attribution", async () => {
    const service = makeService();
    service.prisma.entry.findFirst.mockResolvedValue({ id: 31 });
    vi.spyOn(service, "syncChat").mockResolvedValue([]);
    const completedActivity = activity({
      feedback_due_at: new Date(Date.now() - 60_000),
    });
    service.prisma.round.findUnique.mockResolvedValue(completedActivity);
    service.prisma.activityArtifact.findMany.mockResolvedValue([
      {
        id: 61,
        kind: "response",
        round_id: 9,
        user_id: 2,
        entry_id: 31,
        submitted_at: new Date("2026-09-10T11:00:00Z"),
        source_artifact: {
          id: 51,
          user_id: 3,
          user: { username: "Maya" },
          entry: { id: 21 },
        },
        entry: {
          id: 31,
          user_id: 2,
          room_id: 4,
          published_at: null,
          format_data: { audio_asset_id: 41, image_url: "/cover.jpg" },
        },
      },
    ]);
    service.prisma.activityParticipation.findUnique.mockResolvedValue({
      id: 71,
      submitted_entry_id: null,
    });
    service.prisma.activitySubmission.findFirst.mockResolvedValue(null);
    service.prisma.document.findUnique.mockResolvedValue({ content: { type: "doc", content: [
      { type: "image", attrs: { src: "/cover.jpg" } },
      { type: "audio", attrs: { audioAssetId: 41 } },
    ] } });

    await service.finalize(9);

    expect(service.prisma.entry.updateMany).toHaveBeenCalledWith({
      where: { id: 31, status: { in: ["draft", "published"] } },
      data: expect.objectContaining({
        status: "published",
        format_data: expect.objectContaining({
          round_attribution: expect.objectContaining({
            template_key: "art_before_chorus",
            cover_contributor_id: 3,
            cover_label: "Cover art from Maya",
          }),
        }),
      }),
    });
    expect(service.prisma.square.update).not.toHaveBeenCalled();
    expect(service.prisma.activitySubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ round_id: 9, entry_id: 31, user_id: 2 }),
    });
    expect(service.prisma.round.updateMany).toHaveBeenCalledWith({
      where: { id: 9, status: "active" },
      data: expect.objectContaining({ status: "archived" }),
    });
    expect(service.prisma.chatMessage.upsert).not.toHaveBeenCalled();
  });

  it("does not publish covers or audio before completion", async () => {
    const service = makeService();
    service.prisma.round.findUnique.mockResolvedValue(activity());
    await service.finalize(9);
    expect(service.prisma.$transaction).not.toHaveBeenCalled();
    expect(service.prisma.chatMessage.upsert).not.toHaveBeenCalled();
  });

  it("publishes final combined response posts without copying them into Chat", async () => {
    const service = makeService();
    vi.spyOn(service, "syncChat").mockResolvedValue([]);
    service.prisma.round.findUnique.mockResolvedValue(activity({ feedback_due_at: new Date(Date.now() - 60_000), board: { room_id: 4 } }));
    const artifacts = [
      { id: 1, user_id: 2, kind: "cover", entry_id: 30, entry: { id: 30, user_id: 2 } },
      { id: 2, user_id: 2, kind: "response", entry_id: 31, entry: { id: 31, user_id: 2 } },
      { id: 3, user_id: 3, kind: "cover", entry_id: 32, entry: { id: 32, user_id: 3 } },
      { id: 4, user_id: 3, kind: "response", entry_id: 33, entry: { id: 33, user_id: 3 } },
    ];
    service.prisma.activityArtifact.findMany.mockImplementation(async ({ where }) =>
      where.kind === "response" ? artifacts.filter(artifact => artifact.kind === "response") : artifacts,
    );
    service.prisma.document.findUnique.mockResolvedValue({ content: { type: "doc", content: [
      { type: "image", attrs: { src: "/cover.jpg" } }, { type: "audio", attrs: { audioAssetId: 41 } },
    ] } });
    await service.finalize(9);
    expect(service.prisma.chatMessage.upsert).not.toHaveBeenCalled();
    expect(service.prisma.entry.updateMany).toHaveBeenCalledWith({ where: { id: 31, status: { in: ["draft", "published"] } }, data: expect.objectContaining({ status: "published" }) });
    expect(service.prisma.entry.updateMany).toHaveBeenCalledWith({ where: { id: 33, status: { in: ["draft", "published"] } }, data: expect.objectContaining({ status: "published" }) });
    expect(service.prisma.$transaction).toHaveBeenCalledTimes(1);
    service.prisma.round.updateMany.mockResolvedValue({ count: 0 });
    await service.finalize(9);
    expect(service.prisma.chatMessage.upsert).not.toHaveBeenCalled();
  });

  it("skips a response deleted after artifact selection without publishing dependent state", async () => {
    const service = makeService();
    vi.spyOn(service, "syncChat").mockResolvedValue([]);
    service.prisma.round.findUnique.mockResolvedValue(activity({ feedback_due_at: new Date(0) }));
    service.prisma.activityArtifact.findMany.mockResolvedValue([{ id: 1, user_id: 2, entry_id: 31, entry: { id: 31, room_id: 4, status: "draft" } }]);
    service.prisma.entry.updateMany.mockResolvedValue({ count: 0 });
    await service.finalize(9);
    expect(service.prisma.entry.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 31, status: { in: ["draft", "published"] } } }));
    expect(service.prisma.entry.update).not.toHaveBeenCalled();
    expect(service.prisma.document.findUnique).not.toHaveBeenCalled();
    expect(service.prisma.square.update).not.toHaveBeenCalled();
    expect(service.prisma.activitySubmission.create).not.toHaveBeenCalled();
    expect(service.prisma.activityParticipation.update).not.toHaveBeenCalled();
  });

  it("does not reveal or publish a cancelled Activity", async () => {
    const service = makeService();
    service.prisma.round.findUnique.mockResolvedValue(activity({ status: "cancelled" }));

    await service.finalize(9);

    expect(service.prisma.activityArtifact.findMany).not.toHaveBeenCalled();
    expect(service.prisma.entry.update).not.toHaveBeenCalled();
    expect(service.prisma.round.updateMany).not.toHaveBeenCalled();
  });

  it("claims finalization once before publishing responses", async () => {
    const service = makeService();
    service.prisma.round.findUnique.mockResolvedValue(activity({ feedback_due_at: new Date(Date.now() - 60_000), board: { room_id: 4 } }));
    service.prisma.activityArtifact.findMany.mockResolvedValue([]);
    service.prisma.round.updateMany.mockResolvedValue({ count: 0 });

    await service.finalize(9);

    expect(service.prisma.round.updateMany).toHaveBeenCalledTimes(1);
    expect(service.prisma.entry.update).not.toHaveBeenCalled();
  });
  it("rejects a new cover without a private project source before artifact intake", async () => {
    const service = makeService();
    service.prisma.entry.findUnique.mockResolvedValue({ id: 30, user_id: 2, round_id: 9, status: "draft", creation_origin: "round_activity_cover", room_id: 4 });
    service.prisma.activityParticipation.findFirst.mockResolvedValue({ id: 20, room_id: 4 });
    await expect(service.submitArtifact(activity() as never, 2, { kind: "cover", entryId: 30 })).rejects.toThrow("Save the work in your own project");
    expect(service.prisma.activityArtifact.upsert).not.toHaveBeenCalled();
    expect(service.prisma.entry.update).not.toHaveBeenCalled();
  });
  it("validates shared feedback text as part of an image-only cover submission", async () => {
    const service = makeService();
    service.prisma.entry.findFirst.mockResolvedValue({ id: 80 });
    service.prisma.entry.findUnique.mockResolvedValue({ id: 30, source_entry_id: 80, user_id: 2, round_id: 9, status: "draft", creation_origin: "round_activity_cover", room_id: 4, format: "mixed_media", shared_feedback: [{ source_room_id: 4, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Saved comment" }] }] }, format: "mixed_media", format_data: null }] });
    service.prisma.activityParticipation.findFirst.mockResolvedValue({ id: 20, room_id: 4 });
    service.prisma.document.findUnique.mockResolvedValue({ content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/42" } }] } });
    await expect(service.submitArtifact(activity() as never, 2, { kind: "cover", entryId: 30 })).rejects.toThrow("images only");
    expect(service.prisma.activityArtifact.upsert).not.toHaveBeenCalled();
    expect(service.prisma.entry.update).not.toHaveBeenCalled();
  });

});
