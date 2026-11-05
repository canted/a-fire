import { ForbiddenException } from "@nestjs/common";
import { HomeService } from "@server/api/v1/projects/home.service";
import { vi, expect, it } from "vitest";
vi.mock("@server/api/v1/uploads/identity-images", () => ({ identityImageUrl: vi.fn().mockResolvedValue(null) }));
function setup() {
  const prisma = { chatPresenceSession: { groupBy: vi.fn().mockResolvedValue([]) }, project: { findMany: vi.fn().mockResolvedValue([]) }, $queryRaw: vi.fn().mockResolvedValue([]), document: { findFirst: vi.fn().mockResolvedValue(null) }, activityParticipation: { findMany: vi.fn().mockResolvedValue([]) }, reply: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) }, activitySubmission: { findMany: vi.fn().mockResolvedValue([]) }, roomMembership: { findMany: vi.fn().mockResolvedValue([]) }, entry: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) }, chatMessage: { groupBy: vi.fn().mockResolvedValue([]) }, round: { findMany: vi.fn().mockResolvedValue([]) } };
  const projects = { homeSummaries: vi.fn().mockResolvedValue([]) };
  const entries = { show: vi.fn().mockImplementation(async (_p, id) => ({ id })), list: vi.fn().mockResolvedValue([]) };
  const unseen = { countResponsesToOwnPosts: vi.fn().mockResolvedValue(0), countForUserWithRooms: vi.fn().mockResolvedValue({ overall: { total: 0 }, byRoom: new Map() }) };
  const activities = { show: vi.fn() };
  const circleAccess = { resolve: vi.fn().mockResolvedValue({kind:"member"}), canReadPublishedPostWithRoomHistory: vi.fn().mockResolvedValue(true) };
  const service = new HomeService();
  Object.assign(service, { prisma, projects, entries, unseen, rounds: activities, circleAccess });
  return { service, prisma, projects, entries, rounds: activities, unseen, circleAccess };
}
it("returns an honest first-visit snapshot and excludes revoked and disabled circles", async () => {
  const { service, prisma } = setup();
  const snapshot = await service.snapshot(8, "America/Los_Angeles");
  expect(snapshot).toMatchObject({ rounds: [], recentRooms: [], recentProjects: [], recentEntries: [], contributions: [] });
  expect(snapshot.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(prisma.roomMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { user_id: 8, disabled: false, revoked_at: null, room: { deleted_at: null } } }));
});
it("uses only the viewer's published entries in accepted projects and counts their local dates", async () => {
  const { service, prisma, projects, entries } = setup();
  projects.homeSummaries.mockResolvedValue([{ id: 1, viewer_participation: "owner" }] as never);
  const at = new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  prisma.$queryRaw.mockResolvedValueOnce([{ id: 9, project_id: 1 }]).mockResolvedValueOnce([{ date, count: 1 }]);
  prisma.entry.findMany.mockResolvedValue([{ id: 9, project_id: 1, published_at: at, created_at: at }] as never);
  const snapshot = await service.snapshot(8, "America/Los_Angeles");
  expect(prisma.entry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ user_id: 8, project: { OR: [{ owner_id: 8 }, { participations: { some: { user_id: 8, status: "accepted" } } }] }, status: "published", room_id: null }) }));
  expect(prisma.entry.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 4 }));
  expect(entries.show).toHaveBeenCalledWith(1, 9, 8);
  expect(snapshot.recentEntries).toHaveLength(1);
  expect(snapshot.recentProjects).toHaveLength(1);
  expect(snapshot.contributions).toEqual([{ date: snapshot.today, count: 1 }]);
});
it("validates timezone before querying private data", async () => {
  const { service, prisma } = setup();
  await expect(service.snapshot(8, "invalid/timezone")).rejects.toThrow("Invalid timezone");
  expect(prisma.roomMembership.findMany).not.toHaveBeenCalled();
});

it("omits inaccessible activities without hiding the rest of home", async () => {
  const { service, prisma, rounds: activities } = setup();
  prisma.round.findMany.mockResolvedValue([{ id: 1, room_id: 2 }] as never);
  activities.show.mockRejectedValue(new ForbiddenException("Forbidden"));
  expect((await service.snapshot(8)).rounds).toEqual([]);
  activities.show.mockRejectedValue(new Error("Unexpected database failure"));
  await expect(service.snapshot(8)).rejects.toThrow("Unexpected database failure");
});

it("expands only the viewer's recent activity and leaves the compact home payload small", async () => {
  const { service, prisma, projects } = setup();
  projects.homeSummaries.mockResolvedValue([{ id: 1, name: "Rhythm studies", viewer_participation: "owner" }] as never);
  prisma.project.findMany.mockResolvedValue([{ id: 1, name: "Rhythm studies" }]);
  const now = new Date();
  const old = new Date(now.getTime() - 60 * 86400000);
  prisma.entry.findMany.mockResolvedValue([
    { id: 9, project_id: 1, published_at: now, created_at: now, creation_origin: "project_material", project_intent: "Try a new groove" },
    { id: 10, project_id: 1, published_at: now, created_at: now, creation_origin: "project_feedback" },
    { id: 11, project_id: 1, published_at: old, created_at: old, creation_origin: "project_material" },
  ] as never);
  prisma.$queryRaw.mockImplementation(async query => query.sql.includes("LIMIT 51") ? [
    { id: 9, project_id: 1, published_at: now, created_at: now, creation_origin: "project_material", project_intent: "Try a new groove" },
    { id: 10, project_id: 1, published_at: now, created_at: now, creation_origin: "project_feedback" },
  ] : []);
  expect((await service.snapshot(8)).activityEntries).toBeUndefined();
  const expanded = await service.snapshot(8, "UTC", true);
  expect(expanded.activityEntries).toEqual([
    { id: 9, projectId: 1, projectName: "Rhythm studies", date: expanded.today, kind: "material", label: "Try a new groove" },
    { id: 10, projectId: 1, projectName: "Rhythm studies", date: expanded.today, kind: "feedback", label: "Kept feedback" },
  ]);
});

it("uses scalar database counts for the yearly dashboard", async () => {
  const { service, prisma } = setup();
  prisma.roomMembership.findMany.mockResolvedValue([{ room: { id: 2, name: "Room" } }] as never);
  prisma.$queryRaw.mockResolvedValue([{ activitiesJoined: 2, feedbackGiven: 5000, entriesShared: 3 }]);
  expect((await service.snapshot(8)).roomDashboard).toEqual({ activitiesJoined: 2, feedbackGiven: 5000, entriesShared: 3, newResponses: 0 });
  expect(prisma.activityParticipation.findMany).not.toHaveBeenCalled();
  expect(prisma.reply.findMany).not.toHaveBeenCalled();
  expect(prisma.activitySubmission.findMany).not.toHaveBeenCalled();
});

it("returns a bounded recent peer response to the viewer's published circle work", async () => {
  const { service, prisma } = setup();
  prisma.roomMembership.findMany.mockResolvedValue([{ room: { id: 2, name: "Listening room" } }] as never);
  prisma.reply.findFirst.mockResolvedValue({ id: 91, entry: { id: 42, room_id: 2, square: null } } as never);
  prisma.document.findFirst.mockResolvedValue({ content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Keep that longer pause." }] }] } } as never);
  expect((await service.snapshot(8)).recentFeedback).toEqual({ replyId: 91, entryId: 42, roomName: "Listening room", preview: "Keep that longer pause." });
  expect(prisma.reply.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ user_id: { not: 8 }, status: "published", published_at: { gte: expect.any(Date) }, entry: { user_id: 8, status: "published", room_id: { in: [2] } } }), orderBy: [{ published_at: "desc" }, { id: "desc" }] }));
});

it("reuses one unread scan for Home total and its five recent Rooms", async () => {
  const { service, prisma, unseen } = setup();
  prisma.roomMembership.findMany.mockResolvedValue(Array.from({ length: 7 }, (_, index) => ({ room: { id: index + 1, name: `Room ${index + 1}` } })) as never);
  unseen.countForUserWithRooms.mockResolvedValue({ overall: { total: 30 }, byRoom: new Map([[1, { total: 4 }], [3, { total: 2 }]]) });
  const snapshot = await service.snapshot(8);
  expect(unseen.countForUserWithRooms).toHaveBeenCalledExactlyOnceWith(8, [1, 2, 3, 4, 5]);
  expect(snapshot.totalRoomUnseenCount).toBe(30);
  expect(snapshot.recentRooms.map(room => room.unseenCount)).toEqual([4, 0, 2, 0, 0]);
});

it("fetches unread counts for the displayed Rooms after activity ranking", async () => {
  const { service, prisma, unseen } = setup();
  prisma.roomMembership.findMany.mockResolvedValue(Array.from({ length: 7 }, (_, index) => ({ room: { id: index + 1, name: `Room ${index + 1}` } })) as never);
  prisma.entry.groupBy.mockResolvedValue([{ room_id: 7, _max: { published_at: new Date("2026-01-02Z") } }] as never);
  prisma.chatMessage.groupBy.mockResolvedValue([{ room_id: 6, _max: { created_at: new Date("2026-01-03Z") } }] as never);
  unseen.countForUserWithRooms.mockResolvedValue({ overall: { total: 30 }, byRoom: new Map([[6, { total: 8 }], [7, { total: 9 }]]) });
  const snapshot = await service.snapshot(8);
  expect(unseen.countForUserWithRooms).toHaveBeenCalledExactlyOnceWith(8, [6, 7, 1, 2, 3]);
  expect(snapshot.recentRooms.map(room => [room.id, room.unseenCount])).toEqual([["6", 8], ["7", 9], ["1", 0], ["2", 0], ["3", 0]]);
  expect(snapshot.totalRoomUnseenCount).toBe(30);
});


it.each(["scope", "revoked", "expired"])("does not hydrate a %s-inaccessible Home feedback preview", async reason => {
  const {service,prisma,circleAccess}=setup();
  prisma.roomMembership.findMany.mockResolvedValue([{room:{id:2,name:"Room"}}] as never);
  prisma.reply.findFirst.mockResolvedValue({id:91,entry:{id:42,room_id:reason==="scope"?3:2}} as never);
  if(reason==="revoked")circleAccess.resolve.mockResolvedValue(null);
  if(reason==="expired")circleAccess.canReadPublishedPostWithRoomHistory.mockResolvedValue(false);
  expect((await service.snapshot(8)).recentFeedback).toBeNull();
  expect(prisma.document.findFirst).not.toHaveBeenCalled();
});


it("ranks new memberships and quiet visits ahead of older published activity", async () => {
  const { service, prisma } = setup();
  prisma.roomMembership.findMany.mockResolvedValue(Array.from({ length: 7 }, (_, index) => ({
    room: { id: index + 1, name: `Room ${index + 1}` },
    created_at: new Date(index === 6 ? "2026-11-04T12:00:00Z" : "2026-01-01T00:00:00Z"),
  })) as never);
  prisma.entry.groupBy.mockResolvedValue([{ room_id: 7, _max: { published_at: new Date("2026-11-01T00:00:00Z") } }] as never);
  prisma.chatMessage.groupBy.mockResolvedValue([{ room_id: 1, _max: { created_at: new Date("2026-11-03T00:00:00Z") } }] as never);
  expect((await service.snapshot(8)).recentRooms[0].id).toBe("7");
  prisma.chatPresenceSession.groupBy.mockResolvedValue([{ room_id: 6, _max: { last_seen_at: new Date("2026-11-04T13:00:00Z") } }] as never);
  expect((await service.snapshot(8)).recentRooms.map(room => room.id)).toEqual(["6", "7", "1", "2", "3"]);
  expect(prisma.chatPresenceSession.groupBy).toHaveBeenCalledWith({
    by: ["room_id"], where: { user_id: 8, room_id: { in: [1, 2, 3, 4, 5, 6, 7] } }, _max: { last_seen_at: true },
  });
});
