import { withTestDependencies } from "@tests/backend/helpers/service";
import { NavigationService } from "@server/api/v1/navigation/navigation.service";
import { vi } from "vitest";

type PrismaMock = ReturnType<typeof makePrisma>;

const makePrisma = () => ({
  roomMembership: { findMany: vi.fn() },
  room: { findMany: vi.fn() },
  board: { findMany: vi.fn() },
  page: { findMany: vi.fn() },
  $queryRaw: vi.fn().mockResolvedValue([]),
});

describe("NavigationService", () => {
  const makeService = (prisma: PrismaMock) => {
    return withTestDependencies(new NavigationService(), {
      prisma,
    });
  };

  it("returns empty payload when no memberships", async () => {
    const prisma = makePrisma();
    prisma.roomMembership.findMany.mockResolvedValue([]);

    const service = makeService(prisma);
    const result = await service.slideMenu(1);

    expect(result).toEqual({ rooms: [], currentRoom: null });
  });

  it("returns an empty menu when retained memberships only reference deleted Rooms", async () => {
    const prisma = makePrisma();
    prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 1 }]);
    prisma.room.findMany.mockResolvedValue([]);
    expect(await makeService(prisma).slideMenu(1)).toEqual({ rooms: [], currentRoom: null });
    expect(prisma.page.findMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("builds slide menu payload", async () => {
    const prisma = makePrisma();
    prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 1 }, { room_id: 2 }]);
    prisma.room.findMany.mockResolvedValue([
      { id: 1, name: "A", porosity: "masked" },
      { id: 2, name: "B", porosity: "closed" },
    ]);
    prisma.board.findMany.mockResolvedValue([{ id: 10, room_id: 1, name: "Latest Posts" }]);
    prisma.page.findMany.mockResolvedValue([{ id: 5, title: "Home", icon: "H" }]);
    prisma.$queryRaw.mockResolvedValue([{ record_id: 1, blob_id: 44 }]);

    const service = makeService(prisma);
    const result = await service.slideMenu(1, 2);

    expect(result.rooms).toHaveLength(2);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.board.findMany).not.toHaveBeenCalled();
    expect(result.rooms.every(room => !("memberBoard" in room))).toBe(true);
    expect(result.currentRoom).not.toHaveProperty("memberBoard");
    expect(result.rooms[0].avatar_url).toBe("/api/v1/uploads/44/variants/icon160");
    expect(result.rooms[1].avatar_url).toBeNull();
    expect(result.rooms.map((circle) => circle.porosity)).toEqual(["masked", "closed"]);
    expect(result.currentRoom?.id).toBe("2");
    expect(result.currentRoom?.avatar_url).toBeNull();
    expect(result.currentRoom?.porosity).toBe("closed");
    expect(result.currentRoom?.pages[0].title).toBe("Home");
  });
});
