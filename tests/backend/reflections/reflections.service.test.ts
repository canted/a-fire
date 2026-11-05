import { withTestDependencies } from "@tests/backend/helpers/service";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { vi } from "vitest";
import { ReflectionsService } from "@server/api/v1/reflections/reflections.service";

const { captureReflectionCreatedMock, captureReflectionRemovedMock } = vi.hoisted(() => ({
  captureReflectionCreatedMock: vi.fn(),
  captureReflectionRemovedMock: vi.fn(),
}));

vi.mock("@server/runtime/posthog", () => ({
  capturePosthogEvent: vi.fn(),
  captureReflectionCreated: captureReflectionCreatedMock,
  captureReflectionRemoved: captureReflectionRemovedMock,
}));

type PrismaMock = ReturnType<typeof mockPrisma>;

const mockPrisma = () => {
 const prisma = {
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  page: { findUnique: vi.fn().mockResolvedValue({ id: 3, status: "published", room_id: 5 }) },
  entry: {
    findUnique: vi.fn(),
  },
  reply: {
    findUnique: vi.fn(),
  },
  reflection: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
  },
  roomMembership: {
    findFirst: vi.fn(),
  },
};
 prisma.$transaction.mockImplementation(callback => callback(prisma));
 prisma.$queryRaw.mockImplementation(async (query, id) => query.join("").includes("FROM notes")
   ? [{ room_id: (await prisma.page.findUnique({ where: { id } }))?.room_id }]
   : [{ id }]);
 return prisma;
};

const mockBoss = () => ({
  enqueueInTransaction: vi.fn(),
});

const mockRealtime = () => ({
  emit: vi.fn(),
  entryRoom: vi.fn((id: number) => `post:${id}`),
  boardRoom: vi.fn((id: number) => `board:${id}`),
});

describe("ReflectionsService", () => {
  beforeEach(() => {
    captureReflectionCreatedMock.mockClear();
    captureReflectionRemovedMock.mockClear();
  });

  const makeService = (prisma: PrismaMock) => {
    return withTestDependencies(new ReflectionsService(), {
      prisma,
      boss: mockBoss(),
      realtime: mockRealtime(),
    });
  };

  it.each(["createForPost", "deleteForPost", "createForReply", "deleteForReply"] as const)("rejects %s for private material before disclosure or side effects", async (operation) => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({
      id: 12, project_id: 8, creation_origin: "project_material", room_id: null, square_id: null, square: null,
    });
    prisma.reply.findUnique.mockResolvedValue({ id: 11, status: "published", entry_id: 12 });
    const service = makeService(prisma);
    await expect(service[operation](12, 7, 3)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.page.findUnique).not.toHaveBeenCalled();
    expect(prisma.reflection.create).not.toHaveBeenCalled();
    expect(prisma.reflection.deleteMany).not.toHaveBeenCalled();
    expect(prisma.reflection.findMany).not.toHaveBeenCalled();
    expect(service.boss.enqueueInTransaction).not.toHaveBeenCalled();
    expect(service.realtime.emit).not.toHaveBeenCalled();
  });

  it.each(["create", "delete"])("rejects %s reflection for a reply with no parent post", async (operation) => {
    const prisma = mockPrisma();
    prisma.reply.findUnique.mockResolvedValue({ id: 11, status: "published", entry_id: null });
    const service = makeService(prisma);
    await expect(operation === "create" ? service.createForReply(11, 7, 3) : service.deleteForReply(11, 7, 3))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.entry.findUnique).not.toHaveBeenCalled();
    expect(prisma.reflection.create).not.toHaveBeenCalled();
    expect(prisma.reflection.deleteMany).not.toHaveBeenCalled();
  });

  it.each(["post", "reply"])("rejects a %s reflection into another circle before writes or disclosure", async (kind) => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({ id: 1, status: "published", room_id: 5 });
    prisma.reply.findUnique.mockResolvedValue({ id: 11, status: "published", entry_id: 1 });
    prisma.page.findUnique.mockResolvedValue({ id: 3, status: "published", room_id: 999, title: "Private" });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    const service = makeService(prisma);
    await expect(kind === "post" ? service.createForPost(1, 7, 3) : service.createForReply(11, 7, 3)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.reflection.create).not.toHaveBeenCalled();
    expect(prisma.reflection.findMany).not.toHaveBeenCalled();
    expect(service.boss.enqueueInTransaction).not.toHaveBeenCalled();
    expect(service.realtime.emit).not.toHaveBeenCalled();
  });

  it("creates reflections for posts and emits", async () => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({
      id: 1,
      status: "published",
      room_id: 5,
      square: { room_id: 5, board_id: 9 },
      board_id: null,
    });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    prisma.reflection.create.mockResolvedValue({ id: 10 });
    prisma.reflection.findMany.mockResolvedValue([
      { page_id: 3, user_id: 7, page: { title: "Page", icon: "📄" } },
      { page_id: 3, user_id: 8, page: { title: "Page", icon: "📄" } },
    ]);

    const service = makeService(prisma);
    const payload = await service.createForPost(1, 7, 3);

    expect(payload).toEqual([
      { page_id: 3, page_title: "Page", page_icon: "📄", count: 2, mine: true },
    ]);
    expect(service.boss.enqueueInTransaction).toHaveBeenCalledWith(prisma, "reflections.apply", { reflectionId: 10 });
    expect(service.realtime.emit).toHaveBeenCalledWith(
      "EntryChannel",
      "post:1",
      expect.objectContaining({ type: "post_reflections" }),
    );
    expect(service.realtime.emit).toHaveBeenCalledWith(
      "EntryChannel",
      "post:1",
      expect.objectContaining({ type: "post_reflections" }),
    );
    expect(captureReflectionCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        reflectionId: 10,
        reflectableType: "Post",
        reflectableId: 1,
        pageId: 3,
        roomId: 5,
      }),
    );
  });

  it("deletes post reflections", async () => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({
      id: 1,
      status: "published",
      room_id: 5,
      square: { room_id: 5, board_id: 9 },
      board_id: null,
    });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    prisma.reflection.findMany.mockResolvedValue([]);

    const service = makeService(prisma);
    const payload = await service.deleteForPost(1, 7, 3);

    expect(prisma.reflection.deleteMany).toHaveBeenCalled();
    expect(payload).toEqual([]);
    expect(captureReflectionRemovedMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, reflectableType: "Post", reflectableId: 1, pageId: 3 }),
    );
  });

  it("deletes reply reflections", async () => {
    const prisma = mockPrisma();
    prisma.reply.findUnique.mockResolvedValue({ id: 11, status: "published", entry_id: 1 });
    prisma.entry.findUnique.mockResolvedValue({ id: 1, status: "published", room_id: 5, square: null });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    prisma.reflection.findMany.mockResolvedValue([]);

    const service = makeService(prisma);
    const payload = await service.deleteForReply(11, 7, 3);

    expect(prisma.reflection.deleteMany).toHaveBeenCalled();
    expect(payload).toEqual([]);
  });

  it.each(["post", "reply"])("rejects removing a %s reflection in another Room", async kind => {
    const prisma = mockPrisma();
    prisma.reply.findUnique.mockResolvedValue({ id: 11, status: "published", entry_id: 1 });
    prisma.entry.findUnique.mockResolvedValue({ id: 1, status: "published", room_id: 5, square: null });
    prisma.page.findUnique.mockResolvedValue({ id: 3, status: "published", room_id: 6 });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    const service = makeService(prisma);
    await expect(kind === "post" ? service.deleteForPost(1, 7, 3) : service.deleteForReply(11, 7, 3)).rejects.toThrow("Reflections must stay in the source circle");
    expect(prisma.reflection.deleteMany).not.toHaveBeenCalled();
    expect(service.realtime.emit).not.toHaveBeenCalled();
  });

  it("creates reflections for replies", async () => {
    const prisma = mockPrisma();
    prisma.reply.findUnique.mockResolvedValue({ id: 11, status: "published", entry_id: 1 });
    prisma.entry.findUnique.mockResolvedValue({ id: 1, status: "published", room_id: 5 });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    prisma.reflection.create.mockResolvedValue({ id: 10 });
    prisma.reflection.findMany.mockResolvedValue([
      { page_id: 3, user_id: 7, page: { title: "Page", icon: "📄" } },
    ]);

    const service = makeService(prisma);
    const payload = await service.createForReply(11, 7, 3);

    expect(payload).toEqual([
      { page_id: 3, page_title: "Page", page_icon: "📄", count: 1, mine: true },
    ]);
    expect(service.realtime.emit).toHaveBeenCalledWith(
      "EntryChannel",
      "post:1",
      expect.objectContaining({ type: "reply_reflections" }),
    );
  });

  it("throws when post or reply missing", async () => {
    const prisma = mockPrisma();
    prisma.reply.findUnique.mockResolvedValue(null);

    const service = makeService(prisma);
    await expect(service.createForReply(99, 1, 2)).rejects.toBeInstanceOf(NotFoundException);

    prisma.reply.findUnique.mockResolvedValue({ id: 1, entry_id: 2 });
    prisma.entry.findUnique.mockResolvedValue(null);
    await expect(service.createForReply(1, 1, 2)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws when user not a member", async () => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({ id: 1, status: "published", room_id: 5, square: null });
    prisma.roomMembership.findFirst.mockResolvedValue(null);

    const service = makeService(prisma);
    await expect(service.createForPost(1, 7, 3)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("groups reflections and ignores missing pages", async () => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({ id: 1, status: "published", room_id: 5, square: null });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    prisma.reflection.create.mockResolvedValue({ id: 1 });
    prisma.reflection.findMany.mockResolvedValue([
      { page_id: 3, user_id: 7, page: { title: "Page", icon: "📄" } },
      { page_id: 3, user_id: 8, page: { title: "Page", icon: "📄" } },
      { page_id: 4, user_id: 9, page: null },
    ]);

    const service = makeService(prisma);
    const payload = await service.createForPost(1, 7, 3);

    expect(payload).toEqual([{ page_id: 3, page_title: "Page", page_icon: "📄", count: 2, mine: true }]);
  });
});
