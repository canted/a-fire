import { expect, it, vi } from "vitest";
import { roomSavedResponses } from "@server/api/v1/boards/room-saved-responses";
function setup() {
  const prisma = {
    entry: { findMany: vi.fn().mockResolvedValue([{ source_shared_entry_id: 10, source_entry_id: 1, user_id: 2, source_reply_id: 30, format_data: { saved_reply_ids: [30, 31] }, published_at: new Date("2026-11-04Z") }]) },
    reply: { findMany: vi.fn().mockResolvedValue([{ id: 30, user: { username: "Maya" } }, { id: 31, user: { username: "Maya" } }]) },
    document: { findMany: vi.fn().mockResolvedValue([30, 31].map(id => ({ docable_id: id, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Reply ${id}` }] }] } }))) },
  };
  return prisma;
}
it("shows starred published room replies as one block without reading private documents", async () => {
  const prisma = setup();
  const result = await roomSavedResponses(prisma as never, [{ id: 10, user_id: 2, source_entry_id: 1 }]);
  expect(result.get(10)).toEqual([expect.objectContaining({ id: "30", entryId: "10", text: "Reply 30\n\nReply 31", author: "Maya" })]);
  expect(prisma.reply.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [30, 31] }, entry_id: 10, status: "published" } }));
  expect(prisma.document.findMany).toHaveBeenCalledWith({ where: { docable_type: "Reply", docable_id: { in: [30, 31] } } });
  expect(prisma.entry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "published", room_id: null }) }));
});
it("does not expose another person's saves or another source's saves", async () => {
  for (const shared of [{ id: 10, user_id: 9, source_entry_id: 1 }, { id: 10, user_id: 2, source_entry_id: 9 }]) {
    const prisma = setup();
    expect((await roomSavedResponses(prisma as never, [shared])).size).toBe(0);
    expect(prisma.document.findMany).not.toHaveBeenCalled();
  }
});
it("omits replies no longer published in the shared discussion", async () => {
  const prisma = setup(); prisma.reply.findMany.mockResolvedValue([]);
  expect((await roomSavedResponses(prisma as never, [{ id: 10, user_id: 2, source_entry_id: 1 }])).size).toBe(0);
  expect(prisma.document.findMany).not.toHaveBeenCalled();
});
