import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { syncRoundChat } from "@server/api/v1/rounds/round-chat";

const at = (day: number) => new Date(`2026-09-${day}T12:00:00Z`);
const activity = {
  id: 9, board_id: 3, room_id: 4, host_id: 1, name: "Exchange", prompt: "Make something",
  status: "active", created_at: at(10), started_at: at(11), submit_by: at(12), closed_at: null,
  board: { room_id: 4 }, _count: { participations: 3, submission_records: 3 },
};

function fixture(overrides = {}) {
  const messages = new Map();
  const prisma = {
    round: { findUnique: vi.fn().mockResolvedValue({ ...activity, ...overrides }) },
    chatMessage: { upsert: vi.fn(async ({ create }) => {
      if (!messages.has(create.client_nonce)) messages.set(create.client_nonce, { id: messages.size + 1, ...create });
      return messages.get(create.client_nonce);
    }) },
  };
  return { prisma, messages };
}

describe("activity chat milestones", () => {
  it("reuses the winner when simultaneous milestone insertions race", async () => {
    const { prisma } = fixture({ status: "draft" });
    prisma.chatMessage.upsert.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" }));
    const winner = { id: 27, room_id: 4 };
    const findUniqueOrThrow = vi.fn().mockResolvedValue(winner);
    Object.assign(prisma.chatMessage, { findUniqueOrThrow });
    await expect(syncRoundChat(prisma as never, 9, at(11))).resolves.toEqual([winner]);
    expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { author_id_client_nonce: { author_id: 1, client_nonce: "round:9:created" } } });
  });

  it("backfills reached milestones once, without announcing future phases or completion", async () => {
    const { prisma, messages } = fixture();
    await syncRoundChat(prisma as never, 9, at(11));
    await syncRoundChat(prisma as never, 9, at(11));
    expect([...messages.keys()]).toEqual(["round:9:created", "round:9:started"]);
    expect([...messages.values()].every(message => message.timeline_kind === "round_event" && !message.pinned_at)).toBe(true);
    await syncRoundChat(prisma as never, 9, at(13));
    expect([...messages.keys()]).toEqual(["round:9:created", "round:9:started", "round:9:next-phase"]);
  });

  it("lets the plugin withhold its next phase until its own gate is met", async () => {
    const { prisma, messages } = fixture();
    await syncRoundChat(prisma as never, 9, at(13), { at: null, label: "Audio responses started" });
    expect(messages.has("round:9:next-phase")).toBe(false);
    await syncRoundChat(prisma as never, 9, at(14), { at: at(14), label: "Audio responses started" });
    expect(messages.get("round:9:next-phase").content.round_event.event_label).toBe("Audio responses started");
  });

  it("leaves completion to the transactional Wall announcement", async () => {
    const { prisma, messages } = fixture({ status: "archived", closed_at: at(14) });
    await syncRoundChat(prisma as never, 9, at(15));
    expect(messages.size).toBe(3);
    expect(messages.has("round:9:completed")).toBe(false);
  });
});
