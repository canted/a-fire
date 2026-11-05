import { roomResultPage, roomResultNeighbors } from "@server/api/v1/rounds/room-result-page";
import { repairRoundResults } from "@server/api/v1/rounds/repair-round-results";
import { ForbiddenException } from "@nestjs/common";
import { EntriesReadService } from "@server/api/v1/entries/entries.read.service";
import { ArtBeforeChorusRoundService } from "@server/api/v1/rounds/runtime/art-before-chorus.activity.service";
import { grantRoomVisit } from "@server/api/v1/rooms/room-visit-lease";
import "reflect-metadata";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrismaService } from "@server/prisma/prisma.service";
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service";
import { RoomsService } from "@server/api/v1/rooms/rooms.service";
import { RoundsService } from "@server/api/v1/rounds/rounds.service";
import { WallsService } from "@server/api/v1/rounds/walls.service";
import { publishRoundWall } from "@server/api/v1/rounds/publish-round-wall";
import { ChatService } from "@server/api/v2/rooms/chat.service";

const prisma = new PrismaService();
const users: number[] = [], posts: number[] = [], rounds: number[] = [];
let roomId: number;
const now = new Date();
const access = new RoomAccessService();
Object.assign(access, { prisma });
const lifecycle = { reconcileCircle: vi.fn(), reconcileBoard: vi.fn(), reconcileActivity: vi.fn() };
const walls = new WallsService();
const communities = new RoomsService();
Object.assign(communities, { prisma, circleAccess: access });
Object.assign(walls, { prisma, access, lifecycle, rooms: communities });
const activities = new RoundsService();
Object.assign(activities, { prisma, circleAccess: access, activityLifecycle: lifecycle, rounds: { syncChat: vi.fn().mockResolvedValue([]) }, notifications: { scheduleActivityNotifications: async () => {} } });

beforeEach(async () => {
  for (let i = 0; i < 3; i++) users.push((await prisma.user.create({ data: { email: `wall-${crypto.randomUUID()}@example.invalid`, username: `Wall contributor ${i}`, created_at: now, updated_at: now } })).id);
  roomId = (await prisma.room.create({ data: { name: "Wall test room", porosity: "closed", owner_id: users[0], created_at: now, updated_at: now } })).id;
  await prisma.roomMembership.createMany({ data: users.slice(0, 2).map(user_id => ({ room_id: roomId, user_id, created_at: now, updated_at: now })) });
});
afterEach(async () => {
  await prisma.chatMessage.deleteMany({ where: { room_id: roomId } });
  await prisma.roundResult.deleteMany({ where: { room_id: roomId } });
  await prisma.activityParticipation.deleteMany({ where: { round_id: { in: rounds } } });
  await prisma.activitySubmission.deleteMany({ where: { round_id: { in: rounds } } });
  await prisma.document.deleteMany({ where: { docable_type: "Post", docable_id: { in: posts } } });
  await prisma.reply.deleteMany({ where: { entry_id: { in: posts } } });
  await prisma.entry.deleteMany({ where: { id: { in: posts } } });
  await prisma.round.deleteMany({ where: { id: { in: rounds } } });
  await prisma.roomMembership.deleteMany({ where: { room_id: roomId } });
  await prisma.room.delete({ where: { id: roomId } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  users.length = posts.length = rounds.length = 0;
});
async function round(status = "archived") {
  const value = await prisma.round.create({ data: { room_id: roomId, host_id: users[0], name: "First wall", prompt: "A small sound from the room", status, closed_at: status === "archived" ? now : null, created_at: now, updated_at: now } }); rounds.push(value.id); return value;
}
async function contribution(activityId: number, userId = users[0]) {
  const post = await prisma.entry.create({ data: { user_id: userId, room_id: roomId, round_id: activityId, status: "published", created_at: now, updated_at: now } }); posts.push(post.id);
  await prisma.document.create({ data: { docable_type: "Post", docable_id: post.id, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "An original response" }] }] }, created_at: now, updated_at: now } });
  await prisma.activityParticipation.upsert({ where: { round_id_user_id: { round_id: activityId, user_id: userId } }, create: { round_id: activityId, user_id: userId, role: "participant", submitted_entry_id: post.id, joined_at: now, created_at: now, updated_at: now }, update: { submitted_entry_id: post.id } }); return post;
}
it("publishes once under concurrent completion and preserves old membership and description", async () => {
  const first = await round(); const original = await contribution(first.id);
  await Promise.all([prisma.$transaction(tx => publishRoundWall(tx, first.id)), prisma.$transaction(tx => publishRoundWall(tx, first.id))]);
  const wall = await prisma.roundResult.findUniqueOrThrow({ where: { round_id: first.id } });
  const later = await contribution(first.id);
  await prisma.round.update({ where: { id: first.id }, data: { name: "Edited later", prompt: "Later prompt" } });
  await prisma.$transaction(tx => publishRoundWall(tx, first.id));
  expect(await prisma.roundResult.count({ where: { round_id: first.id } })).toBe(1);
  expect(await prisma.chatMessage.count({ where: { room_id: roomId, entry_origin: "wall_publication" } })).toBe(1);
  const announcement = await prisma.chatMessage.findFirstOrThrow({ where: { room_id: roomId, entry_origin: "wall_publication" } });
  expect(announcement).toMatchObject({ pinned_at: null, entry_id: null, timeline_kind: "round_event", created_at: wall.published_at });
  expect(announcement.content).toMatchObject({ round_event: { wall_id: wall.id, id: first.id, event_label: "Wall published", occurred_at: wall.published_at.toISOString() } });
  const detail = await walls.show(wall.id, users[0]);
  expect(detail.title).toBe("First wall"); expect(detail.description).toBe("A small sound from the room");
  expect(detail.entries.map(entry => entry.entryId)).toEqual([String(original.id)]);
  expect(detail.entries.some(entry => entry.entryId === String(later.id))).toBe(false);
  await prisma.entry.update({ where: { id: original.id }, data: { status: "deleted" } });
  expect((await walls.show(wall.id, users[0])).entries[0]).toMatchObject({ available: false, entryId: null, content: null });
});
it("projects and repairs legacy Wall notices by structured identity, preserving IDs and ordinary authored history", async () => {
  const first = await round(); await contribution(first.id);
  const wall = await prisma.$transaction(tx => publishRoundWall(tx, first.id));
  const announcement = await prisma.chatMessage.findFirstOrThrow({ where: { room_id: roomId, entry_origin: "wall_publication" } });
  const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "A new Wall is ready: First wall" }] }] };
  await prisma.chatMessage.update({ where: { id: announcement.id }, data: { timeline_kind: "message", content, created_at: new Date(now.getTime() - 86400000) } });
  const ordinary = await prisma.chatMessage.create({ data: { room_id: roomId, author_id: users[0], body: "A new Wall is ready: First wall", content, client_nonce: "wall:999999:published", masked_alias: "", fire_at: now, expires_at: new Date(now.getTime() + 86400000), created_at: now, updated_at: now } });
  const chat = new ChatService(); Object.assign(chat, { prisma, circleAccess: access, rooms: communities });
  const timeline = await chat.listMessages(roomId, users[0]);
  expect(timeline.messages.find(row => row.id === announcement.id)).toMatchObject({ author: null, mine: false, can_convert: false, created_at: wall!.published_at.toISOString(), round_event: { wall_id: wall!.id, event_label: "Wall published" } });
  expect(timeline.messages.find(row => row.id === ordinary.id)).toMatchObject({ round_event: null, author: { id: users[0] }, content });
  expect((await chat.message(roomId, announcement.id, users[0])).round_event?.wall_id).toBe(wall!.id);
  expect((await prisma.chatMessage.findUniqueOrThrow({ where: { id: announcement.id } })).timeline_kind).toBe("message");
  await walls.list(roomId, users[0]);
  expect((await prisma.chatMessage.findUniqueOrThrow({ where: { id: announcement.id } })).timeline_kind).toBe("message");
  await repairRoundResults(prisma, roomId, { execute: true });
  await repairRoundResults(prisma, roomId, { execute: true });
  const repaired = await prisma.chatMessage.findUniqueOrThrow({ where: { id: announcement.id } });
  expect(repaired).toMatchObject({ timeline_kind: "round_event", client_nonce: announcement.client_nonce, author_id: announcement.author_id, created_at: wall!.published_at });
  expect(repaired.content).toMatchObject({ round_event: { wall_id: wall!.id } });
  expect(await prisma.chatMessage.count({ where: { room_id: roomId, entry_origin: "wall_publication" } })).toBe(1);
  expect((await prisma.chatMessage.findUniqueOrThrow({ where: { id: ordinary.id } })).content).toEqual(content);
});
it("records only the specified wall for the authenticated member and leaves all read state alone", async () => {
  const first = await round(); await contribution(first.id);
  const oldWall = await prisma.$transaction(tx => publishRoundWall(tx, first.id));
  const next = await round(); await contribution(next.id);
  const newWall = await prisma.$transaction(tx => publishRoundWall(tx, next.id));
  const before = await prisma.chatMessageRead.count({ where: { user_id: { in: users } } });
  await walls.present(oldWall!.id, users[0]); await walls.present(oldWall!.id, users[0]);
  expect(await prisma.roundResultPresentation.count({ where: { user_id: users[0] } })).toBe(1);
  expect((await walls.list(roomId, users[0])).walls.find(wall => wall.id === String(oldWall!.id))?.presented).toBe(true);
  expect((await walls.list(roomId, users[0])).walls.find(wall => wall.id === String(newWall!.id))?.presented).toBe(false);
  expect((await walls.list(roomId, users[1])).walls.every(wall => !wall.presented)).toBe(true);
  expect(await prisma.chatMessageRead.count({ where: { user_id: { in: users } } })).toBe(before);
  await expect(walls.show(oldWall!.id, users[2])).rejects.toThrow("Forbidden");
  await expect(walls.present(oldWall!.id, users[2])).rejects.toThrow("Forbidden");
  await prisma.roomMembership.updateMany({ where: { room_id: roomId, user_id: users[0] }, data: { disabled: true } });
  await expect(walls.show(oldWall!.id, users[0])).rejects.toThrow("Forbidden");
});
it("allows only one concurrent active Round creation per Room", async () => {
  const results = await Promise.allSettled([
    activities.createForRoom(roomId, users[0], { name: "First", status: "active" }),
    activities.createForRoom(roomId, users[0], { name: "Second", status: "active" }),
  ]);
  const created = await prisma.round.findMany({ where: { room_id: roomId } });
  rounds.push(...created.map(item => item.id));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(created).toHaveLength(1);
  expect(created[0].status).toBe("active");
  await expect(round("active")).rejects.toThrow();
  expect((await walls.list(roomId, users[0])).walls).toEqual([]);
});

it("archives an ordinary round with one announcement and keeps preexisting legacy chat records", async () => {
  const current = await round("active"); const post = await contribution(current.id);
  const legacy = await prisma.chatMessage.create({ data: { room_id: roomId, author_id: users[0], entry_id: post.id, pinned_at: now, body: "A legacy contribution", masked_alias: "", fire_at: now, expires_at: new Date(now.getTime() + 86400000), created_at: now, updated_at: now } });
  await Promise.all([activities.archive(current.id, users[0]), activities.archive(current.id, users[0])]);
  const wall = await prisma.roundResult.findUniqueOrThrow({ where: { round_id: current.id } });
  await prisma.round.update({ where: { id: current.id }, data: { host_id: users[1] } });
  await prisma.$transaction(tx => publishRoundWall(tx, current.id));
  expect(await prisma.chatMessage.count({ where: { room_id: roomId, entry_origin: "wall_publication" } })).toBe(1);
  expect(await prisma.chatMessage.findUnique({ where: { id: legacy.id } })).toMatchObject({ body: legacy.body, pinned_at: now, entry_id: post.id });
  expect((await walls.show(wall.id, users[0])).entries[0].entryId).toBe(String(post.id));
});

it("counts only published replies, deduplicates identities, and conceals summaries for unavailable entries", async () => {
  const activity = await round(); const post = await contribution(activity.id);
  const wall = await prisma.$transaction(tx => publishRoundWall(tx, activity.id));
  await prisma.reply.createMany({ data: [
    { entry_id: post.id, user_id: users[0], status: "published", created_at: now, updated_at: now },
    { entry_id: post.id, user_id: users[1], status: "published", created_at: now, updated_at: now },
    { entry_id: post.id, user_id: users[1], status: "published", created_at: now, updated_at: now },
    { entry_id: post.id, user_id: users[1], status: "draft", created_at: now, updated_at: now },
  ] });
  const detail = await walls.show(wall!.id, users[0]);
  expect(detail.entries[0].responseCount).toBe(3);
  expect(detail.entries[0].responseParticipants.map(person => person.id)).toEqual(users.slice(0, 2));
  await expect(walls.show(wall!.id, users[2])).rejects.toThrow();
  await prisma.entry.update({ where: { id: post.id }, data: { status: "deleted" } });
  expect((await walls.show(wall!.id, users[0])).entries[0]).toMatchObject({ responseCount: 0, responseParticipants: [], authorAvatarUrl: null });
});

it("allows Open visitor results without participation and immediately denies limited or expired visits", async () => {
  const first = await round(); const original = await contribution(first.id);
  const wall = await prisma.$transaction(tx => publishRoundWall(tx, first.id));
  await prisma.roomKnock.create({ data: { room_id: roomId, user_id: users[2], status: "admitted", created_at: now, updated_at: now } });
  await grantRoomVisit(prisma, roomId, users[2], "knock", new Date());
  await expect(walls.show(wall!.id, users[2])).rejects.toThrow("Forbidden");
  await prisma.room.update({ where: { id: roomId }, data: { porosity: "open" } });
  expect((await walls.list(roomId, users[2])).walls.map(item => item.id)).toEqual([String(wall!.id)]);
  expect((await walls.show(wall!.id, users[2])).entries.map(entry => entry.entryId)).toEqual([String(original.id)]);
  const listing = await activities.listForRoom(roomId, users[2]);
  expect(listing.recentRounds.map(activity => activity.id)).toEqual([String(first.id)]);
  expect(listing.nextRound).toBeNull();
  const detail = await activities.show(first.id, users[2]);
  expect(detail.submissions.map(submission => submission.entryId)).toEqual([String(original.id)]);
  expect(detail.viewerAccess).toEqual({ kind: "visitor", canParticipate: false, scope: "all" });
  expect(detail.round.viewerAccess).toMatchObject({ scope: "all" });
  await expect(walls.present(wall!.id, users[2])).rejects.toThrow("Members only");
  await prisma.room.update({ where: { id: roomId }, data: { porosity: "masked" } });
  await expect(activities.show(first.id, users[2])).rejects.toThrow("Forbidden");
  await expect(walls.list(roomId, users[2])).rejects.toThrow("Forbidden");
  await expect(walls.show(wall!.id, users[2])).rejects.toThrow("Forbidden");
  await prisma.room.update({ where: { id: roomId }, data: { porosity: "open" } });
  await prisma.roomVisit.updateMany({ where: { room_id: roomId, user_id: users[2] }, data: { last_activity_at: new Date(0), expires_at: new Date(86400000) } });
  await expect(walls.show(wall!.id, users[2])).rejects.toThrow("Forbidden");
});

it.each(["before selection", "after selection"])("preserves response deletion %s during specialized Round completion", async timing => {
  const first = await round("active");
  await prisma.round.update({ where: { id: first.id }, data: { template_key: "art_before_chorus" } });
  const deleted = await contribution(first.id, users[0]);
  const retained = await contribution(first.id, users[1]);
  if (timing === "before selection") await prisma.entry.update({ where: { id: deleted.id }, data: { status: "deleted" } });
  await prisma.entry.update({ where: { id: retained.id }, data: { status: "draft" } });
  for (const post of [deleted, retained]) await prisma.activityArtifact.create({ data: { round_id: first.id, user_id: post.user_id!, entry_id: post.id, kind: "response", submitted_at: now, created_at: now, updated_at: now } });
  const runtime = new ArtBeforeChorusRoundService();
  let raced = false;
  const racingPrisma = prisma.$extends({ query: { activityArtifact: {
    async findMany({ args, query }) {
      const selected = await query(args);
      if (timing === "after selection" && !raced && args.where?.kind === "response") {
        expect(selected.some(artifact => artifact.entry_id === deleted.id)).toBe(true);
        // A separate committed database write overlaps the open completion transaction.
        await prisma.entry.update({ where: { id: deleted.id }, data: { status: "deleted" } });
        raced = true;
      }
      return selected;
    },
  } } });
  Object.assign(runtime, { prisma: racingPrisma });
  const sync = vi.spyOn(runtime, "syncChat").mockResolvedValue([]);
  try {
    await runtime.finalize(first.id, true);
    expect(raced).toBe(timing === "after selection");
    expect((await prisma.entry.findUniqueOrThrow({ where: { id: deleted.id } })).status).toBe("deleted");
    expect((await prisma.entry.findUniqueOrThrow({ where: { id: retained.id } })).status).toBe("published");
    const wall = await prisma.roundResult.findUniqueOrThrow({ where: { round_id: first.id } });
    expect((await walls.show(wall.id, users[0])).entries.filter(entry => entry.available).map(entry => entry.entryId)).toEqual([String(retained.id)]);
    const completed = await prisma.round.findUniqueOrThrow({ where: { id: first.id } });
    const detail = await runtime.detail(completed, users[0], "member");
    expect(detail.viewer.response).toBeUndefined();
    expect(await prisma.document.count({ where: { docable_type: "Post", docable_id: deleted.id } })).toBe(1);
  } finally { sync.mockRestore(); }
});

it.each(["round_event", "message"])("does not expose, present or reannounce a misplaced Wall with a %s notice", async timelineKind => {
  const first = await round(); await contribution(first.id);
  const wall = await prisma.$transaction(tx => publishRoundWall(tx, first.id));
  const other = await prisma.room.create({ data: { name: "Other Room", owner_id: users[0], created_at: now, updated_at: now } });
  try {
    await prisma.roomMembership.create({ data: { room_id: other.id, user_id: users[0], created_at: now, updated_at: now } });
    await prisma.roundResult.update({ where: { id: wall!.id }, data: { room_id: other.id } });
    const announcement = await prisma.chatMessage.findFirstOrThrow({ where: { room_id: roomId, entry_origin: "wall_publication" } });
    await prisma.chatMessage.update({ where: { id: announcement.id }, data: { timeline_kind: timelineKind } });
    const chat = new ChatService(); Object.assign(chat, { prisma, circleAccess: access, rooms: communities });
    expect((await chat.listMessages(roomId, users[0])).messages.some(message => message.id === announcement.id)).toBe(false);
    await expect(chat.message(roomId, announcement.id, users[0])).rejects.toThrow("Message not found");
    const ordinary = await prisma.chatMessage.create({ data: { room_id: roomId, author_id: users[0], body: "Still visible", content: { type: "doc", content: [] }, masked_alias: "", fire_at: now, expires_at: new Date(Date.now() + 86400000), created_at: now, updated_at: now } });
    const filteredPage = await chat.listMessages(roomId, users[0], { after: 0, limit: 1 });
    expect(filteredPage.messages).toEqual([]);
    expect(filteredPage.next_cursor).toBe(announcement.id);
    const nextPage = await chat.listMessages(roomId, users[0], { after: filteredPage.next_cursor!, limit: 1 });
    expect(nextPage.messages.map(message => message.id)).toEqual([ordinary.id]);


    await expect(walls.show(wall!.id, users[0])).rejects.toThrow("Wall Room scope conflicts");
    await expect(walls.present(wall!.id, users[0])).rejects.toThrow("Wall Room scope conflicts");
    expect((await walls.list(other.id, users[0])).walls).toEqual([]);
    await expect(prisma.$transaction(tx => publishRoundWall(tx, first.id))).rejects.toThrow("Wall Room scope conflicts");
    expect(await prisma.roundResultPresentation.count({ where: { round_result_id: wall!.id } })).toBe(0);
    expect(await prisma.chatMessage.count({ where: { room_id: other.id } })).toBe(0);
    expect((await prisma.roundResult.findUniqueOrThrow({ where: { id: wall!.id } })).room_id).toBe(other.id);
  } finally {
    await prisma.roundResult.update({ where: { id: wall!.id }, data: { room_id: roomId } });
    await prisma.roomMembership.deleteMany({ where: { room_id: other.id } });
    await prisma.room.delete({ where: { id: other.id } });
  }
});

it.each(["before", "after"])("withholds an Entry moved to another Room %s Wall publication", async when => {
  const first = await round(); const post = await contribution(first.id);
  const other = await prisma.room.create({ data: { name: "Private boundary", owner_id: users[0], created_at: now, updated_at: now } });
  try {
    let wall = when === "after" ? await prisma.$transaction(tx => publishRoundWall(tx, first.id)) : null;
    await prisma.entry.update({ where: { id: post.id }, data: { room_id: other.id } });
    wall ??= await prisma.$transaction(tx => publishRoundWall(tx, first.id));
    const detail = await walls.show(wall!.id, users[0]);
    if (when === "before") expect(detail.entries).toEqual([]);
    else expect(detail.entries[0]).toMatchObject({ available: false, entryId: null, content: null });
    const reads = new EntriesReadService(); Object.assign(reads, { prisma });
    expect(await reads.listPosts(null, users[0])).toEqual([]);
    const persisted = await prisma.entry.findUniqueOrThrow({ where: { id: post.id } });
    const roomAccess = await access.require(roomId, users[0]);
    expect(await access.canReadPublishedPostWithRoomHistory(persisted, roomAccess)).toBe(false);
    expect(persisted.room_id).toBe(other.id);
  } finally {
    await prisma.entry.update({ where: { id: post.id }, data: { room_id: roomId } });
    await prisma.room.delete({ where: { id: other.id } });
  }
});

it("uses live Room membership for Entry lists", async () => {
  const first = await round(); const post = await contribution(first.id);
  const reads = new EntriesReadService(); Object.assign(reads, { prisma, circleAccess: access });
  expect((await reads.listPosts(roomId, users[0])).map(entry => entry.id)).toEqual([String(post.id)]);
  try {
    await prisma.roomMembership.updateMany({ where: { room_id: roomId, user_id: users[0] }, data: { disabled: true } });
    await expect(reads.listPosts(roomId, users[0])).rejects.toBeInstanceOf(ForbiddenException);
    expect(await reads.listPosts(null, users[0])).toEqual([]);
  } finally {
    await prisma.roomMembership.updateMany({ where: { room_id: roomId, user_id: users[0] }, data: { disabled: false } });
  }
});

it("does not expose expired or historically pinned Chat attachments through Entry lists", async () => {
  const first = await round(); const post = await contribution(first.id);
  await prisma.entry.update({ where: { id: post.id }, data: { creation_origin: "chat_attachment" } });
  const recent = new Date();
  const message = await prisma.chatMessage.create({ data: { room_id: roomId, author_id: users[0], entry_id: post.id, body: "Attachment", content: { type: "doc", content: [{ type: "image", attrs: { src: "/retained.png" } }] }, masked_alias: "", fire_at: recent, expires_at: new Date(recent.getTime() + 86400000), created_at: recent, updated_at: recent } });
  let queries = 0;
  const database = prisma.$extends({ query: { chatMessage: { async findMany({ args, query }) { queries++; return query(args); } } } });
  const reads = new EntriesReadService(); Object.assign(reads, { prisma: database, circleAccess: access });
  expect((await reads.listPosts(roomId, users[0])).map(entry => entry.id)).toEqual([String(post.id)]);
  expect(queries).toBe(1);
  await prisma.chatMessage.update({ where: { id: message.id }, data: { expires_at: new Date(0) } });
  expect(await reads.listPosts(roomId, users[0])).toEqual([]);
  await prisma.chatMessage.update({ where: { id: message.id }, data: { created_at: new Date(recent.getTime() - 15 * 86400000), expires_at: new Date(recent.getTime() + 86400000), pinned_at: recent } });
  expect(await reads.listPosts(null, users[0])).toEqual([]);
  expect((await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("published");
});

it("previews and resumes bounded result repair without changing active rounds or duplicating notices", async () => {
  for (let index = 0; index < 53; index++) await round();
  const active = await round("active");
  const preview = await repairRoundResults(prisma, roomId);
  expect(preview.inspected).toBe(50);
  expect(preview.candidates).toHaveLength(50);
  expect(preview.nextAfter).not.toBeNull();
  expect(await prisma.roundResult.count({ where: { room_id: roomId } })).toBe(0);
  const attempts = await Promise.all([0, 1].map(() => repairRoundResults(prisma, roomId, { through: preview.through, execute: true })));
  const first = attempts[0];
  expect(attempts.flatMap(result => result.repaired)).toHaveLength(50);
  const resumed = await repairRoundResults(prisma, roomId, { through: first.through, after: first.nextAfter!, execute: true });
  expect(resumed.repaired).toHaveLength(3);
  expect(resumed.nextAfter).toBeNull();
  expect((await repairRoundResults(prisma, roomId, { through: first.through, execute: true })).repaired).toEqual([]);
  expect(await prisma.chatMessage.count({ where: { room_id: roomId, entry_origin: "wall_publication" } })).toBe(53);
  expect(await prisma.round.findUniqueOrThrow({ where: { id: active.id } })).toMatchObject({ status: "active", closed_at: null });
  const expected = await prisma.roundResult.findMany({ where: { room_id: roomId }, orderBy: [{ published_at: "desc" }, { id: "desc" }], select: { id: true } });
  expect(await roomResultNeighbors(prisma, roomId, expected[30].id)).toEqual({ previousWallId: String(expected[31].id), nextWallId: String(expected[29].id) });
  expect(await roomResultNeighbors(prisma, roomId, expected[0].id)).toEqual({ previousWallId: String(expected[1].id), nextWallId: null });
  expect(await roomResultNeighbors(prisma, roomId, expected.at(-1)!.id)).toEqual({ previousWallId: null, nextWallId: String(expected.at(-2)!.id) });
  const page1 = await roomResultPage(prisma, roomId, users[0]);
  expect(page1.ids).toEqual(expected.slice(0, 20).map(row => row.id));
  await prisma.roundResult.delete({ where: { id: page1.ids.at(-1)! } });
  const page2 = await roomResultPage(prisma, roomId, users[0], page1.nextCursor!);
  expect(page2.ids).toEqual(expected.slice(20, 40).map(row => row.id));
  const page3 = await roomResultPage(prisma, roomId, users[0], page2.nextCursor!);
  expect(page3.ids).toEqual(expected.slice(40).map(row => row.id));
  expect(page3.nextCursor).toBeNull();
  const unrepaired = await round();
  const apiFirst = await walls.list(roomId, users[0], "");
  expect(await prisma.roundResult.findUnique({ where: { round_id: unrepaired.id } })).toBeNull();
  expect(apiFirst.walls).toHaveLength(20);
  expect(apiFirst.nextCursor).toBeTruthy();
  await prisma.roomMembership.updateMany({ where: { room_id: roomId, user_id: users[0] }, data: { disabled: true } });
  await expect(walls.list(roomId, users[0], apiFirst.nextCursor!)).rejects.toThrow("Forbidden");

  await expect(roomResultPage(prisma, roomId, users[1], page1.nextCursor!)).rejects.toThrow("Invalid Room results cursor");
  await expect(roomResultPage(prisma, roomId + 1, users[0], page1.nextCursor!)).rejects.toThrow("Invalid Room results cursor");

});
