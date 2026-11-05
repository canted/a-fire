import { RoundNotificationsService } from "@server/api/v1/rounds/round-notifications.service";
import { withTestDependencies } from "@tests/backend/helpers/service";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { RoundsService } from "@server/api/v1/rounds/rounds.service";
import { vi } from "vitest";

const makePrisma = () => {
  const prisma = {
    room: { findUnique: vi.fn().mockResolvedValue({ reply_mode: "simple" }) },
    board: { findUnique: vi.fn() },
    roomMembership: { count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    round: { findUniqueOrThrow: vi.fn().mockResolvedValue({ status: "active" }), create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    activityParticipation: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    activitySubmission: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    activityOffer: { findMany: vi.fn().mockResolvedValue([]) },
    activityArtifact: { groupBy: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(3), findMany: vi.fn(), findUnique: vi.fn() },
    square: { findFirst: vi.fn(), findUnique: vi.fn() },
    entry: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    reply: { findMany: vi.fn(), groupBy: vi.fn().mockResolvedValue([]) },
    document: { findMany: vi.fn() },
    activeStorageAttachment: { findMany: vi.fn() },
    notificationEvent: { create: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
  };
  prisma.$transaction.mockImplementation((callback) => callback(prisma));
  return prisma;
};

describe("ActivitiesService", () => {
  const makeService = () => {
    const prisma = makePrisma();
    const boss = { enqueue: vi.fn(), enqueueAfter: vi.fn(), enqueueInTransaction: vi.fn(), hasOutstandingJob: vi.fn().mockResolvedValue(false) };
    return withTestDependencies(new RoundsService(), {
      prisma,
      boss,
      notifications: withTestDependencies(new RoundNotificationsService(), { prisma, boss, rounds: { syncChat: vi.fn() }, lifecycle: { reconcileActivity: vi.fn() } }),
      circleAccess: { requireManager: vi.fn().mockResolvedValue({ kind: "member", canManage: true, room: { id: 4, name: "Current Room" } }), requireMember: vi.fn().mockResolvedValue({ kind: "member", room: { id: 4, name: "Current Room" } }), requireMemberInTransaction: vi.fn().mockResolvedValue({ kind: "member", canManage: true, room: { id: 4, name: "Current Room" } }), require: vi.fn().mockResolvedValue({ kind: "member", room: { id: 4, name: "Current Room" } }), canReadPublishedPostWithRoomHistory: vi.fn().mockImplementation(async (post: { id: number }) => post.id === 20) },
      activityLifecycle: { reconcileBoard: vi.fn(), reconcileCircle: vi.fn(), reconcileActivity: vi.fn().mockResolvedValue(false) },
      realtime: { emit: vi.fn(), room: vi.fn((roomId: number) => `room:${roomId}`), boardRoom: vi.fn((boardId: number) => `board:${boardId}`) },
      rounds: {
        syncChat: vi.fn(),
        submitArtifact: vi.fn(),
        choose: vi.fn(),
        removeArtifact: vi.fn(),
        validateDraft: vi.fn(),
        prepareForDetail: vi.fn(),
        detail: vi.fn(),
        complete: vi.fn(),
      },
    });
  };

  it("includes the viewer's published work and replies across active and older activities in one query", async () => {
    const service = makeService();
    service.prisma.board.findUnique.mockResolvedValue({ id: 3, room_id: 4 });
    const active = { updated_at: new Date("2026-10-06"), id: 9, room_id: 4, host_id: 1, name: "Current", status: "active" };
    const older = { ...active, id: 7, name: "Earlier", status: "archived" };
    service.prisma.round.findFirst.mockResolvedValueOnce(active).mockResolvedValueOnce(null);
    service.prisma.round.findMany.mockResolvedValueOnce([older]).mockResolvedValueOnce([active]);
    service.prisma.roomMembership.findMany.mockResolvedValue([]);
    service.prisma.activityOffer.findMany.mockResolvedValue([]);
    service.prisma.activityParticipation.findUnique.mockResolvedValue(null);
    service.prisma.entry.findMany.mockResolvedValue([
      { id: 101, round_id: 9, user_id: 8, replies: [], _count: { replies: 2 } },
      { id: 102, round_id: 7, user_id: 2, replies: [{ id: 39 }], _count: { replies: 1 } },
    ]);
    const result = await service.listForRoom(4, 8);
    expect(result.activeRound?.roomId).toBe("4");
    expect(result.recentRounds[0].roomId).toBe("4");
    expect(result.activeRound?.viewerContributions).toEqual([{ entryId: "101", kind: "submission", replyCount: 2, occurredAt: undefined, label: "Your shared work" }]);
    expect(result.recentRounds[0].viewerContributions).toEqual([{ entryId: "102", kind: "reply", replyId: "39", occurredAt: undefined, label: "Your feedback" }]);
    expect(service.prisma.entry.findMany).toHaveBeenCalledOnce();
    expect(service.prisma.entry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "published", round_id: { in: [9, 7] }, OR: [{ user_id: 8 }, { replies: { some: { user_id: 8, status: "published" } } }] }) }));
  });

  it("returns only the active published Activity to visitors and no archive or participation state", async () => {
    const service = makeService();
    service.circleAccess.require.mockResolvedValue({ kind: "visitor", room: { id: 2, porosity: "masked" } });
    service.prisma.board.findUnique.mockResolvedValue({ id: 3, room_id: 4 });
    service.prisma.round.findMany.mockResolvedValue([{
      id: 9,
      room_id: 4,
      host_id: 1,
      name: "Active",
      status: "active",
      submit_by: null,
      feedback_due_at: null,
      closed_at: null,
    }]);

    const result = await service.listForRoom(4, 8);

    expect(service.prisma.round.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "active" }) }));
    expect(service.prisma.activityParticipation.findUnique).not.toHaveBeenCalled();
    expect(result.nextRound).toBeNull();
    expect(result.recentRounds).toEqual([]);
    expect(result.activeRound).not.toHaveProperty("hostId");
    expect(result.activeRound?.viewerState).toEqual(
      expect.objectContaining({ canJoin: false, canReview: false, canFollow: false, canSubmit: false }),
    );
    expect(result.viewerAccess).toEqual({ kind: "visitor", canParticipate: false, scope: "active_published_only" });
  });

  it("creates an active activity with Room feedback defaults", async () => {
    const service = makeService();
    service.prisma.room.findUnique.mockResolvedValue({ reply_mode: "guided", default_feedback_types: ["question"], default_idea_guidance: "craft" });
    service.prisma.board.findUnique.mockResolvedValue({
      id: 3,
      name: "Latest Posts",
      room_id: 4,
      reply_mode: "guided",
      default_feedback_types: ["question"],
      default_idea_guidance: "craft",
    });
    service.prisma.round.findFirst.mockResolvedValue(null);
    service.prisma.round.create.mockResolvedValue({
      id: 9,
      board_id: null,
      room_id: 4,
      host_id: 1,
      name: "June Activity",
      prompt: "Make one thing",
      status: "active",
      started_at: new Date(),
      submit_by: new Date("2027-06-30T12:00:00Z"),
      feedback_due_at: null,
      closed_at: null,
      reply_mode: "guided",
      requested_feedback_types: ["question"],
      idea_guidance: "craft",
    });
    service.prisma.activityParticipation.findUnique.mockResolvedValue(null);

    const result = await service.createForRoom(4, 1, {
      name: "June Activity",
      prompt: "Make one thing",
      submitBy: "2027-06-30T12:00:00Z",
    });

    expect(service.prisma.round.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "active",
          room_id: 4,
          reply_mode: "guided",
          requested_feedback_types: ["question"],
          idea_guidance: "craft",
        }),
      }),
    );
    expect(result).toEqual(expect.objectContaining({ id: "9", name: "June Activity", status: "active" }));
    expect(service.boss.enqueueInTransaction).toHaveBeenCalledWith(
      service.prisma, "rounds.notification",
      expect.objectContaining({
        activityId: 9,
        milestone: "submission_deadline_soon",
        expectedAt: "2027-06-30T12:00:00.000Z",
      }),
      expect.objectContaining({ startAfter: expect.any(Date) }),
    );
  });

  it("rejects a retained Board alias when the canonical Room manager policy denies access", async () => {
    const service = makeService();
    service.prisma.board.findUnique.mockResolvedValue({ id: 3, room_id: 4, owner_id: 1 });
    service.circleAccess.requireManager.mockRejectedValue(new Error("Circle manager only"));
    await expect(service.createForRoom(4, 1, { name: "Denied" })).rejects.toThrow("Circle manager only");
    expect(service.circleAccess.requireManager).toHaveBeenCalledWith(4, 1);
    expect(service.prisma.round.create).not.toHaveBeenCalled();
  });

  it("rejects another active activity anywhere in the same circle under a transaction lock", async () => {
    const service = makeService();
    service.prisma.board.findUnique.mockResolvedValue({ id: 3, room_id: 4, name: "Legacy storage" });
    service.prisma.round.findFirst.mockResolvedValue({ id: 99 });
    await expect(service.createForRoom(4, 1, { name: "Duplicate" })).rejects.toThrow("Room already has an ongoing round");
    expect(service.prisma.round.findFirst).toHaveBeenCalledWith({ where: {
      room_id: 4, status: "active",
    }, select: { id: true } });
    expect(service.prisma.$executeRaw).toHaveBeenCalled();
    expect(service.prisma.round.create).not.toHaveBeenCalled();
  });

  it("requires a circle with at least three members before opening The Art Before the Chorus", async () => {
    const service = makeService();
    service.prisma.board.findUnique.mockResolvedValue({
      id: 3,
      name: "Small Circle",
      room_id: 4,
      reply_mode: "simple",
      default_feedback_types: [],
      default_idea_guidance: null,
    });
    service.prisma.round.findFirst.mockResolvedValue(null);
    service.prisma.roomMembership.count.mockResolvedValue(2);

    await expect(
      service.createForRoom(4, 1, {
        name: "Sleeve Exchange",
        status: "active",
        submitBy: "2027-06-30T12:00:00Z",
        feedbackDueAt: "2027-07-02T12:00:00Z",
        templateKey: "art_before_chorus",
      }),
    ).rejects.toThrow("The Art Before the Chorus needs at least 3 participants");

    expect(service.prisma.round.create).not.toHaveBeenCalled();
  });

  it("does not allow a completed Activity to be edited or restarted", async () => {
    const service = makeService();
    service.prisma.round.findUnique.mockResolvedValue({
      id: 9,
      room_id: 4,
      name: "Finished Activity",
      status: "archived",
      template_key: "feedback",
      template_config: {},
    });
    service.prisma.board.findUnique.mockResolvedValue({ id: 3, name: "Wall", room_id: 4 });

    await expect(service.update(9, 1, { name: "Changed" })).rejects.toThrow(
      "Completed Activities cannot be edited",
    );
    await expect(service.start(9, 1)).rejects.toThrow(
      "Completed Activities cannot be restarted",
    );
    expect(service.prisma.round.update).not.toHaveBeenCalled();
  });

  it("requires an active participant to submit to a activity", async () => {
    const service = makeService();
    service.prisma.round.findUnique.mockResolvedValue({
      id: 9,
      room_id: 4,
      status: "active",
      submit_by: new Date("2027-06-30T12:00:00Z"),
    });
    service.prisma.board.findUnique.mockResolvedValue({ id: 3, room_id: 4 });
    service.prisma.square.findUnique.mockResolvedValue({ id: 5, board_id: 3, user_id: 2 });
    service.prisma.activityParticipation.findUnique.mockResolvedValue({
      id: 10,
      round_id: 9,
      user_id: 2,
      role: "participant",
      status: "active",
    });

    await expect(service.validateActivitySubmission(9, 2)).resolves.toEqual(
      expect.objectContaining({
        participation: expect.objectContaining({ role: "participant" }),
      }),
    );
  });

  it("announces activity contributions to every open Activity screen", async () => {
    const service = makeService();
    service.prisma.round.findUnique.mockResolvedValue({
      id: 9,
      room_id: 4,
      template_key: "art_before_chorus",
    });
    service.prisma.board.findUnique.mockResolvedValue({ id: 3, room_id: 4 });
    service.rounds.submitArtifact.mockResolvedValue({ id: "17", kind: "cover" });

    await service.submitRoundArtifact(9, 2, { kind: "cover", entryId: 21 });

    expect(service.prisma.$transaction).toHaveBeenCalledOnce();
    expect(service.prisma.$queryRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining("pg_notify('afire_room_changes'")]), "4",
    );
  });

  it("rejects activity submissions after submit_by", async () => {
    const service = makeService();
    service.prisma.round.findUnique.mockResolvedValue({
      id: 9,
      room_id: 4,
      status: "active",
      submit_by: new Date("2020-06-30T12:00:00Z"),
    });

    await expect(service.validateActivitySubmission(9, 2)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects reviewers as submitters", async () => {
    const service = makeService();
    service.prisma.round.findUnique.mockResolvedValue({
      id: 9,
      room_id: 4,
      status: "active",
      submit_by: new Date("2027-06-30T12:00:00Z"),
    });
    service.prisma.board.findUnique.mockResolvedValue({ id: 3, room_id: 4 });
    service.prisma.square.findUnique.mockResolvedValue({ id: 5, board_id: 3, user_id: 2 });
    service.prisma.activityParticipation.findUnique.mockResolvedValue({
      id: 10,
      round_id: 9,
      user_id: 2,
      role: "reviewer",
      status: "active",
    });

    await expect(service.validateActivitySubmission(9, 2)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("detaches the prior primary submission when replacing a activity submission", async () => {
    const service = makeService();
    service.prisma.activityParticipation.findUnique.mockResolvedValue({ id: 10, submitted_entry_id: 20 });

    await service.markSubmitted(9, 21, 2);

    expect(service.prisma.activitySubmission.updateMany).toHaveBeenCalledWith({
      where: {
        round_id: 9,
        user_id: 2,
        entry_id: 20,
        superseded_at: null,
      },
      data: { superseded_at: expect.any(Date), updated_at: expect.any(Date) },
    });
    expect(service.prisma.entry.updateMany).toHaveBeenCalledWith({
      where: { id: 20, round_id: 9 },
      data: { round_id: null, updated_at: expect.any(Date) },
    });
    expect(service.prisma.activitySubmission.create).toHaveBeenCalledWith({
      data: {
        round_id: 9,
        activity_participation_id: 10,
        entry_id: 21,
        user_id: 2,
        submitted_at: expect.any(Date),
        created_at: expect.any(Date),
        updated_at: expect.any(Date),
      },
    });
    expect(service.prisma.activityParticipation.update).toHaveBeenCalledWith({
      where: { round_id_user_id: { round_id: 9, user_id: 2 } },
      data: { submitted_entry_id: 21, updated_at: expect.any(Date) },
    });
  });

  it("orders feedback-phase submissions without feedback first and preserves submitted order", async () => {
    const service = makeService();
    const now = Date.now();
    service.prisma.round.findUnique.mockResolvedValue({
      id: 9,
      room_id: 4,
      host_id: 1,
      name: "Making Activity",
      prompt: "Share one thing",
      status: "active",
      started_at: new Date(now - 10_000),
      submit_by: new Date(now - 5_000),
      feedback_due_at: new Date(now + 86_400_000),
    });
    service.prisma.board.findUnique.mockResolvedValue({ id: 3, room_id: 4 });
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    service.prisma.roomMembership.findMany.mockResolvedValue([
      { user_id: 2, username_override: null, user: { username: "First" } },
      { user_id: 3, username_override: "Second", user: { username: "Other" } },

    ]);
    service.prisma.activityParticipation.findMany.mockResolvedValue([
      {
        id: 10,
        user_id: 2,
        role: "participant",
        status: "active",
        joined_at: new Date(now - 30_000),
        submitted_entry_id: 20,
        square_id: 12,
        user: { username: "First" },
        square: { name: "First" },
      },
      {
        id: 11,
        user_id: 3,
        role: "reviewer",
        status: "active",
        joined_at: new Date(now - 20_000),
        submitted_entry_id: 21,
        square_id: 13,
        user: { username: "Second" },
        square: { name: "Second" },
      },
      {
        id: 12,
        user_id: 4,
        role: "participant",
        status: "active",
        joined_at: new Date(now - 10_000),
        submitted_entry_id: null,
        square_id: 14,
        user: { username: "Waiting" },
        square: { name: "Obsolete position name" },
      },
    ]);
    service.prisma.entry.findMany.mockResolvedValue([
      { id: 20, content: null, format: "mixed_media", format_data: null, subject: null, created_at: new Date(now - 20_000) },
      { id: 21, content: null, format: "mixed_media", format_data: null, subject: null, room_statement: "Listen for the pause", shared_feedback: [{ source_room_id: 7, author_name: "Maya", content: { type: "doc", content: [] }, private_record_id: 99 }], created_at: new Date(now - 10_000) },
    ]);
    service.prisma.activitySubmission.findMany.mockResolvedValue([
      { entry_id: 20, submitted_at: new Date(now - 20_000) },
      { entry_id: 21, submitted_at: new Date(now - 10_000) },
    ]);
    service.prisma.reply.groupBy.mockImplementation(async ({ where }) => where.user_id
      ? [{ entry_id: 20 }]
      : [{ entry_id: 20, _count: { _all: 1 } }]);
    service.prisma.document.findMany.mockResolvedValue([]);
    service.prisma.activeStorageAttachment.findMany.mockResolvedValue([]);
    service.prisma.activityParticipation.findUnique.mockResolvedValue(null);

    const result = await service.show(9, 1);
    expect(result.viewerUserId).toBe("1");
    for (const participant of [...result.participants, ...result.reviewers, ...result.followers]) {
      expect(participant).not.toHaveProperty("squareId");
      expect(participant.userId).toBeTruthy();
    }
    for (const submission of result.submissions) expect(submission).not.toHaveProperty("squareId");

    expect(result.phase).toBe("feedback");
    expect(result.submissions.map((submission) => submission.entryId)).toEqual(["21", "20"]);
    expect(result.submissions.map((submission) => submission.replyCount)).toEqual([0, 1]);
    expect(result.submissions[0].room_statement).toBe("Listen for the pause");
    expect(result.submissions[0].shared_feedback).toEqual([expect.objectContaining({ author_name: "Maya", source_room_id: 7 })]);
    expect(result.submissions[0].shared_feedback?.[0]).not.toHaveProperty("private_record_id");
    expect(result.feedbackSummary.reviewedCount).toBe(1);
    expect(result.feedbackProgress).toEqual({ givenCount: 1, totalCount: 2 });
    expect(result.reviewers[0]).toEqual(expect.objectContaining({ displayUsername: "Second", submittedEntryId: "21" }));
    expect(result.participants[1]).toEqual(expect.objectContaining({ displayUsername: "Waiting", submittedEntryId: null }));
    expect(service.prisma.activityParticipation.findMany).toHaveBeenCalledWith(expect.objectContaining({ include: { user: true } }));
  });

  it("filters visitor Activity submissions to posts that are currently visible under Room access policy", async () => {
    const service = makeService();
    service.circleAccess.require.mockResolvedValue({ kind: "visitor", room: { id: 2, porosity: "masked" } });
    service.prisma.round.findUnique.mockResolvedValue({
      id: 9,
      template_key: "art_before_chorus",
      room_id: 4,
      host_id: 1,
      name: "Making Activity",
      status: "active",
      started_at: new Date(),
      submit_by: null,
      feedback_due_at: null,
    });
    service.prisma.board.findUnique.mockResolvedValue({ id: 3, room_id: 4 });
    service.prisma.activityParticipation.findMany.mockResolvedValue([
      { id: 10, user_id: 2, role: "participant", status: "active", joined_at: new Date(), submitted_entry_id: 20, square_id: 12, user: { username: "First" }, square: { name: "First" } },
      { id: 11, user_id: 3, role: "participant", status: "active", joined_at: new Date(), submitted_entry_id: 21, square_id: 13, user: { username: "Old" }, square: { name: "Old" } },
    ]);
    service.prisma.entry.findMany.mockResolvedValue([
      { id: 20, content: null, format: "mixed_media", format_data: null, subject: null, created_at: new Date(), square: { id: 12, current_entry_id: 20 } },
      { id: 21, content: null, format: "mixed_media", format_data: null, subject: null, created_at: new Date(), square: { id: 13, current_entry_id: 22 } },
    ]);
    service.prisma.activitySubmission.findMany.mockResolvedValue([
      { entry_id: 20, submitted_at: new Date() },
      { entry_id: 21, submitted_at: new Date() },
    ]);
    service.prisma.reply.groupBy.mockResolvedValue([
      { entry_id: 20, _count: { _all: 1 } },
      { entry_id: 21, _count: { _all: 1 } },
    ]);
    service.prisma.document.findMany.mockResolvedValue([]);
    service.prisma.roomMembership.findMany.mockResolvedValue([]);
    service.prisma.activeStorageAttachment.findMany.mockResolvedValue([]);

    const result = await service.show(9, 8);

    expect(result.submissions.map((submission) => submission.entryId)).toEqual(["20"]);
    expect(result.roundState).toBeUndefined();
    expect(service.rounds.detail).not.toHaveBeenCalled();
    expect(result.participants).toEqual([]);
    expect(result.reviewers).toEqual([]);
    expect(result.followers).toEqual([]);
    expect(result.feedbackSummary.replyCount).toBe(1);
    expect(result.viewerAccess).toEqual({ kind: "visitor", canParticipate: false, scope: "active_published_only" });
  });

  it("sends submission-phase reminders only to active participants without submissions", async () => {
    const service = makeService();
    service.prisma.round.findUnique.mockResolvedValue({
      id: 9,
      room_id: 4,
      name: "Making Activity",
      status: "active",
      started_at: new Date(Date.now() - 10_000),
      submit_by: new Date(Date.now() + 86_400_000),
      feedback_due_at: new Date(Date.now() + 172_800_000),
    });
    service.prisma.board.findUnique.mockResolvedValue({ id: 3, room_id: 4 });
    service.prisma.activityParticipation.findMany.mockResolvedValue([
      { user_id: 2, submitted_entry_id: null },
      { user_id: 3, submitted_entry_id: 20 },
      { user_id: 4, submitted_entry_id: null },
    ]);
    service.prisma.notificationEvent.create
      .mockResolvedValueOnce({ id: 101 })
      .mockResolvedValueOnce({ id: 102 });

    await expect(service.remindForCurrentPhase(9, 1)).resolves.toEqual({ sent: 2, phase: "submission" });

    expect(service.prisma.notificationEvent.create).toHaveBeenCalledTimes(2);
    expect(service.prisma.notificationEvent.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ event_type: "round_reminder", target_user_id: 2 }),
      }),
    );
    expect(service.prisma.notificationEvent.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ event_type: "round_reminder", target_user_id: 4 }),
      }),
    );
    expect(service.boss.enqueueInTransaction).toHaveBeenCalledWith(service.prisma, "notifications.fanout", { eventId: 101 });
    expect(service.boss.enqueueInTransaction).toHaveBeenCalledWith(service.prisma, "notifications.fanout", { eventId: 102 });
  });

  it("does not remind feedback participants who already replied", async () => {
    const service = makeService();
    service.prisma.round.findUnique.mockResolvedValue({
      id: 9,
      room_id: 4,
      name: "Making Activity",
      status: "active",
      started_at: new Date(Date.now() - 172_800_000),
      submit_by: new Date(Date.now() - 86_400_000),
      feedback_due_at: new Date(Date.now() + 86_400_000),
    });
    service.prisma.board.findUnique.mockResolvedValue({ id: 3, room_id: 4 });
    service.prisma.activityParticipation.findMany.mockResolvedValue([
      { user_id: 2, submitted_entry_id: 20 },
      { user_id: 3, submitted_entry_id: 21 },
      { user_id: 4, submitted_entry_id: null },
    ]);
    service.prisma.reply.groupBy.mockResolvedValue([{ user_id: 2 }]);
    service.prisma.notificationEvent.create
      .mockResolvedValueOnce({ id: 103 })
      .mockResolvedValueOnce({ id: 104 });

    await expect(service.remindForCurrentPhase(9, 1)).resolves.toEqual({ sent: 2, phase: "feedback" });

    const targets = service.prisma.notificationEvent.create.mock.calls.map(([input]) => input.data.target_user_id);
    expect(targets).toEqual([3, 4]);
  });

  it("sends a response reminder for The Art Before the Chorus to the selected participant", async () => {
    const service = makeService();
    service.prisma.round.findUnique.mockResolvedValue({
      id: 9,
      room_id: 4,
      name: "Sleeve Exchange",
      status: "active",
      template_key: "art_before_chorus",
      started_at: new Date(Date.now() - 172_800_000),
      submit_by: new Date(Date.now() - 86_400_000),
      feedback_due_at: new Date(Date.now() + 86_400_000),
    });
    service.prisma.board.findUnique.mockResolvedValue({ id: 3, room_id: 4 });
    service.prisma.activityParticipation.findUnique.mockResolvedValue({
      user_id: 2,
      role: "participant",
      status: "active",
      submitted_entry_id: null,
    });
    service.prisma.activityArtifact.findUnique.mockResolvedValue(null);
    service.prisma.notificationEvent.create.mockResolvedValue({ id: 105 });

    await expect(service.remindParticipantToSubmit(9, 2, 1)).resolves.toEqual({ sent: 1, phase: "feedback" });

    expect(service.prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          target_user_id: 2,
          payload: expect.objectContaining({
            excerpt: "Please choose a cover and add your response to Sleeve Exchange.",
          }),
        }),
      }),
    );
  });

  it("ignores scheduled notifications after their deadline changes", async () => {
    const service = makeService();
    service.prisma.round.findUnique.mockResolvedValue({
      id: 9,
      status: "active",
      room_id: 4,
      submit_by: new Date("2027-06-30T12:00:00.000Z"),
    });

    await service.handleScheduledNotification({
      roundId: 9,
      milestone: "submission_deadline_soon",
      expectedAt: "2027-06-29T12:00:00.000Z",
    });

    expect(service.prisma.activityParticipation.findMany).not.toHaveBeenCalled();
    expect(service.prisma.notificationEvent.create).not.toHaveBeenCalled();
  });

  it("schedules future milestones for active Activities when the worker starts", async () => {
    const service = makeService();
    const submitBy = new Date(Date.now() + 172_800_000);
    const feedbackDueAt = new Date(Date.now() + 345_600_000);
    service.prisma.round.findMany.mockResolvedValue([
      {
        id: 9,
        status: "active",
        started_at: new Date(Date.now() - 86_400_000),
        submit_by: submitBy,
        feedback_due_at: feedbackDueAt,
      },
    ]);

    await service.scheduleActiveActivityNotifications();

    const milestones = service.boss.enqueueInTransaction.mock.calls.map(([, , data]) => data.milestone);
    expect(milestones).toEqual([
      "submission_deadline_soon",
      "feedback_started",
      "feedback_deadline_soon",
      "round_completed",
    ]);
  });

  it("notifies only reviewers and participants who have not given feedback before the deadline", async () => {
    const service = makeService();
    const feedbackDueAt = new Date(Date.now() + 60_000);
    service.prisma.round.findUnique.mockResolvedValue({
      id: 9,
      room_id: 4,
      host_id: 1,
      name: "Making Activity",
      status: "active",
      feedback_due_at: feedbackDueAt,
    });
    service.prisma.activityParticipation.findMany.mockResolvedValue([
      { user_id: 2, role: "participant", submitted_entry_id: 20 },
      { user_id: 3, role: "reviewer", submitted_entry_id: null },
      { user_id: 4, role: "reviewer", submitted_entry_id: null },
      { user_id: 5, role: "follower", submitted_entry_id: null },
    ]);
    service.prisma.reply.groupBy.mockResolvedValue([{ user_id: 2 }]);
    service.prisma.notificationEvent.create
      .mockResolvedValueOnce({ id: 201 })
      .mockResolvedValueOnce({ id: 202 });

    await service.handleScheduledNotification({
      roundId: 9,
      milestone: "feedback_deadline_soon",
      expectedAt: feedbackDueAt.toISOString(),
    });

    const targets = service.prisma.notificationEvent.create.mock.calls.map(([input]) => input.data.target_user_id);
    expect(targets).toEqual([3, 4]);
    expect(service.prisma.notificationEvent.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: "round_deadline_approaching",
          payload: expect.objectContaining({ include_actor: true }),
        }),
      }),
    );
    expect(service.boss.enqueueInTransaction).toHaveBeenCalledTimes(2);
  });

  it("does not create the same scheduled notification twice for one recipient", async () => {
    const service = makeService();
    const feedbackDueAt = new Date(Date.now() - 1_000);
    service.prisma.round.findUnique.mockResolvedValue({
      id: 9,
      room_id: 4,
      host_id: 1,
      name: "Making Activity",
      status: "active",
      feedback_due_at: feedbackDueAt,
    });
    service.prisma.activityParticipation.findMany.mockResolvedValue([
      { user_id: 2, role: "reviewer", submitted_entry_id: null },
    ]);
    service.prisma.notificationEvent.findFirst.mockResolvedValue({ id: 400 });

    await service.handleScheduledNotification({
      roundId: 9,
      milestone: "round_completed",
      expectedAt: feedbackDueAt.toISOString(),
    });

    expect(service.prisma.notificationEvent.create).not.toHaveBeenCalled();
    expect(service.boss.enqueueInTransaction).not.toHaveBeenCalled();
  });

  it("notifies every active Activity role when the Activity completes", async () => {
    const service = makeService();
    const feedbackDueAt = new Date(Date.now() - 1_000);
    service.prisma.round.findUnique.mockResolvedValue({
      id: 9,
      room_id: 4,
      host_id: 1,
      name: "Making Activity",
      status: "active",
      feedback_due_at: feedbackDueAt,
    });
    service.prisma.activityParticipation.findMany.mockResolvedValue([
      { user_id: 1, role: "participant", submitted_entry_id: 20 },
      { user_id: 2, role: "reviewer", submitted_entry_id: null },
      { user_id: 3, role: "follower", submitted_entry_id: null },
    ]);
    service.prisma.notificationEvent.create
      .mockResolvedValueOnce({ id: 301 })
      .mockResolvedValueOnce({ id: 302 })
      .mockResolvedValueOnce({ id: 303 });

    await service.handleScheduledNotification({
      roundId: 9,
      milestone: "round_completed",
      expectedAt: feedbackDueAt.toISOString(),
    });

    const targets = service.prisma.notificationEvent.create.mock.calls.map(([input]) => input.data.target_user_id);
    expect(targets).toEqual([1, 2, 3]);
    expect(service.prisma.notificationEvent.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            activity_name: "Making Activity",
            milestone: "round_completed",
            excerpt: "Open Making Activity to see the results.",
          }),
        }),
      }),
    );
  });
});
