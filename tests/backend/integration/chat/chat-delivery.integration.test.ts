// @vitest-environment node
import "reflect-metadata";
import { expect, it, vi } from "vitest";
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service";
import { ChatService } from "@server/api/v2/rooms/chat.service";
import { PrismaService } from "@server/prisma/prisma.service";
import { BossService } from "@server/queue/boss.service";
import { loadTestEnvironment } from "@server/runtime/test-environment.mjs";
import { loadEnv } from "@server/runtime/loadEnv";

it("atomically commits chat and Boss jobs, rolls back queue failure, and deduplicates concurrent retries", async () => {
  loadEnv();
  loadTestEnvironment({ requireDatabase: true });
  const prisma = new PrismaService();
  const boss = new BossService();
  const now = new Date();
  const user = await prisma.user.create({ data: { email: `chat-atomic-${crypto.randomUUID()}@example.com`, username: "Atomic", created_at: now, updated_at: now } });
  const circle = await prisma.room.create({ data: { name: "Atomic chat", owner_id: user.id, porosity: "open", created_at: now, updated_at: now } });
  await prisma.roomMembership.create({ data: { room_id: circle.id, user_id: user.id, created_at: now, updated_at: now } });
  const access = new RoomAccessService();
  Object.assign(access, { prisma });
  const service = new ChatService();
  const realtime = { chatRoom: (id: number) => `chat:${id}`, emit: vi.fn() };
  Object.assign(service, {
    prisma, boss, realtime,
    circleAccess: access,
    rooms: { listMembersForChat: async () => ({ members: [] }) },
  });
  const realEnqueue = boss.enqueueInTransaction.bind(boss);
  const enqueue = vi.spyOn(boss, "enqueueInTransaction");
  try {
    await boss.start();
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { targetType: "user", targetId: String(user.id), label: "Atomic", href: "/app/note/999999", avatarUrl: "/api/v1/uploads/999999" } }] }] };
    const forged = structuredClone(content);
    forged.content[0].content[0].attrs.targetId = "2147483647";
    await expect(service.sendMessage(circle.id, user.id, { body: "Forged", content: forged, clientNonce: "forged" })).rejects.toThrow("Mention unavailable");
    expect(await prisma.chatMessage.count({ where: { room_id: circle.id } })).toBe(0);
    expect(await prisma.notificationEvent.count({ where: { room_id: circle.id } })).toBe(0);
    enqueue.mockRejectedValueOnce(new Error("queue insert failed"));
    await expect(service.sendMessage(circle.id, user.id, { body: "Rollback", clientNonce: "rollback" })).rejects.toThrow("queue insert failed");
    expect(await prisma.chatMessage.count({ where: { room_id: circle.id } })).toBe(0);
    expect(await prisma.notificationEvent.count({ where: { room_id: circle.id } })).toBe(0);
    expect(realtime.emit).not.toHaveBeenCalled();
    enqueue.mockImplementation(realEnqueue);
    const [first, retry] = await Promise.all([
      service.sendMessage(circle.id, user.id, { body: "Durable", content, clientNonce: "same-request" }),
      service.sendMessage(circle.id, user.id, { body: "Durable", content, clientNonce: "same-request" }),
    ]);
    expect(first.id).toBe(retry.id);
    const stored = await prisma.chatMessage.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored.content).toMatchObject({ content: [{ content: [{ attrs: { href: `/app/rooms/${circle.id}/members/${user.id}`, avatarUrl: null } }] }] });
    expect(await prisma.chatMessage.count({ where: { room_id: circle.id } })).toBe(1);
    const events = await prisma.notificationEvent.findMany({ where: { room_id: circle.id } });
    expect(events).toHaveLength(1);
    const jobs = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM pgboss.job
      WHERE name = 'notifications.fanout' AND data->>'eventId' = ${String(events[0].id)}`;
    expect(jobs.map(job => job.name)).toEqual(["notifications.fanout"]);
    expect(realtime.emit).toHaveBeenCalledWith("ChatChannel", `chat:${circle.id}`, expect.objectContaining({ message_id: first.id }));
    // Revoke after preflight, while preparing dependencies before the transaction.
    const start = vi.spyOn(boss, "start").mockImplementationOnce(async () => {
      await prisma.roomMembership.updateMany({ where: { room_id: circle.id, user_id: user.id }, data: { disabled: true } });
    });
    try {
      await expect(service.sendMessage(circle.id, user.id, { body: "Revoked before commit", clientNonce: "revoked" })).rejects.toThrow("Forbidden");
      expect(await prisma.chatMessage.count({ where: { room_id: circle.id } })).toBe(1);
      expect(await prisma.notificationEvent.count({ where: { room_id: circle.id } })).toBe(1);
    } finally { start.mockRestore(); }

  } finally {
    enqueue.mockRestore();
    const messages = await prisma.chatMessage.findMany({ where: { room_id: circle.id }, select: { id: true } });
    const events = await prisma.notificationEvent.findMany({ where: { room_id: circle.id }, select: { id: true } });
    for (const message of messages) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name = 'chat.expire' AND data->>'messageId' = ${String(message.id)}`;
    for (const event of events) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name = 'notifications.fanout' AND data->>'eventId' = ${String(event.id)}`;
    await prisma.notificationEvent.deleteMany({ where: { room_id: circle.id } });
    await prisma.chatMessage.deleteMany({ where: { room_id: circle.id } });
    await prisma.roomMembership.deleteMany({ where: { room_id: circle.id } });
    await prisma.room.delete({ where: { id: circle.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await boss.onModuleDestroy();
    await prisma.$disconnect();
  }
}, 20_000);
