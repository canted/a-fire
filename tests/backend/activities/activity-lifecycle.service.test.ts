import { syncRoundChat } from "@server/api/v1/rounds/round-chat";
import { RoundLifecycleService } from "@server/api/v1/rounds/round-lifecycle.service";
import { withTestDependencies } from "@tests/backend/helpers/service";
import { vi } from "vitest";

vi.mock("@server/api/v1/rounds/publish-round-wall", () => ({ publishRoundWall: vi.fn() }));
vi.mock("@server/api/v1/rounds/round-chat", () => ({ syncRoundChat: vi.fn() }));

function makeService() {
  const prisma = {
    $transaction: vi.fn(),
    $executeRaw: vi.fn().mockResolvedValue(1),
    round: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  prisma.$transaction.mockImplementation(callback => callback(prisma));
  const activities = { complete: vi.fn(), syncChat: vi.fn() };
  return withTestDependencies(new RoundLifecycleService(), { prisma, rounds: activities });
}

describe("ActivityLifecycleService", () => {
  it("persists Feedback completion and Chat milestones in the same transaction", async () => {
    const service = makeService();
    const dueAt = new Date("2026-09-01T18:00:00Z");
    const now = new Date("2026-09-10T18:00:00Z");
    service.prisma.round.findFirst.mockResolvedValue({ id: 9 });
    service.prisma.round.findMany.mockResolvedValue([
      { id: 9, template_key: "feedback", feedback_due_at: dueAt },
    ]);

    await service.reconcileCircle(4, now);

    expect(service.prisma.round.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ room_id: 4 }) }));
    expect(service.prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(syncRoundChat).toHaveBeenCalledWith(service.prisma, 9, now);
    expect(service.rounds.syncChat).not.toHaveBeenCalled();
  });

  it("lets the registered activity complete its own elapsed Activity", async () => {
    const service = makeService();
    service.prisma.round.findFirst.mockResolvedValue({
      id: 10,
      room_id: 4,
      template_key: "art_before_chorus",
      feedback_due_at: new Date("2026-09-01T18:00:00Z"),
    });

    await expect(service.reconcileActivity(10)).resolves.toBe(true);

    expect(service.rounds.complete).toHaveBeenCalledWith(10, "art_before_chorus");
    expect(service.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("leaves a current Activity active", async () => {
    const service = makeService();
    service.prisma.round.findFirst.mockResolvedValue(null);

    await expect(service.reconcileActivity(11)).resolves.toBe(false);

    expect(service.prisma.$executeRaw).not.toHaveBeenCalled();
    expect(service.rounds.complete).not.toHaveBeenCalled();
  });
});
