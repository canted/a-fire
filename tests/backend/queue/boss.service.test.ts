import { vi } from "vitest";

const sendMock = vi.fn();
const sendAfterMock = vi.fn();
const cancelMock = vi.fn();
const workMock = vi.fn();
const createQueueMock = vi.fn();
const ensureIndexesMock = vi.fn().mockResolvedValue({ rows: [{ ready: true }] });
const stopMock = vi.fn();
const startMock = vi.fn().mockResolvedValue(undefined);

vi.mock("pg-boss", () => {
  class PgBossMock {
    start = startMock;
    stop = stopMock;
    send = sendMock;
    sendAfter = sendAfterMock;
    cancel = cancelMock;
    work = workMock;
    createQueue = createQueueMock;
    getDb = () => ({ executeSql: ensureIndexesMock });
    constructor() {}
  }

  return { default: PgBossMock };
});

import { BossService } from "@server/queue/boss.service";

describe("BossService", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendAfterMock.mockReset();
    cancelMock.mockReset();
    workMock.mockReset();
    createQueueMock.mockReset();
    ensureIndexesMock.mockReset().mockResolvedValue({ rows: [{ ready: true }] });
    stopMock.mockReset();
    startMock.mockReset().mockResolvedValue(undefined);
    process.env.DATABASE_URL = "postgres://example";
  });

  it("does not start pg-boss during service construction", () => {
    new BossService();

    expect(startMock).not.toHaveBeenCalled();
  });

  it("can start pg-boss explicitly", async () => {
    const service = new BossService();

    await service.start();

    expect(startMock).toHaveBeenCalled();
  });

  it("enqueues jobs", async () => {
    const service = new BossService();
    await service.enqueue("queue", { ok: true });

    expect(sendMock).toHaveBeenCalledWith("queue", { ok: true });
  });

  it("enqueues jobs with send options", async () => {
    const service = new BossService();
    await service.enqueue("queue", { ok: true }, { expireInMinutes: 60 });

    expect(sendMock).toHaveBeenCalledWith("queue", { ok: true }, { expireInMinutes: 60 });
  });

  it("creates media upload queues during startup", async () => {
    const service = new BossService();

    await service.enqueue("queue", { ok: true });

    expect(createQueueMock).toHaveBeenCalledWith("uploads.audio");
    expect(createQueueMock).toHaveBeenCalledWith("uploads.video");
  });

  it("creates the delayed notification push queue during startup", async () => {
    const service = new BossService();

    await service.enqueue("queue", { ok: true });

    expect(createQueueMock).toHaveBeenCalledWith("notifications.push.delayed");
  });

  it("creates the chat expiration queue during startup", async () => {
    const service = new BossService();

    await service.enqueue("queue", { ok: true });

    expect(createQueueMock).toHaveBeenCalledWith("chat.expire");
  });

  it("enqueues jobs after a due date", async () => {
    const service = new BossService();
    const dueAt = new Date("2026-01-01T00:00:00.000Z");
    sendAfterMock.mockResolvedValue("job-1");

    const jobId = await service.enqueueAfter("queue", { ok: true }, dueAt);

    expect(jobId).toBe("job-1");
    expect(sendAfterMock).toHaveBeenCalledWith("queue", { ok: true }, {}, dueAt);
  });

  it("runs workers", async () => {
    const service = new BossService();
    const handler = vi.fn().mockResolvedValue(undefined);
    workMock.mockImplementation(async (_queue: string, cb: (jobs: any[]) => Promise<void>) => {
      await cb([{ data: { id: 1 } }, { data: { id: 2 } }]);
    });

    await service.work("queue", handler);

    expect(handler).toHaveBeenCalledWith({ id: 1 });
    expect(handler).toHaveBeenCalledWith({ id: 2 });
  });

  it("cleans up on destroy", async () => {
    const service = new BossService();
    await service.enqueue("queue", { ok: true });

    await service.onModuleDestroy();

    expect(stopMock).toHaveBeenCalled();
  });
});

it("retries initialization after a startup failure", async () => {
  startMock.mockReset().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(undefined);
  stopMock.mockResolvedValue(undefined);
  const service = new BossService();
  await expect(service.start()).rejects.toThrow("unavailable");
  await service.start();
  expect(startMock).toHaveBeenCalledTimes(2);
  await service.onModuleDestroy();
});

it("waits for a single queue shutdown and cannot restart afterward", async () => {
  process.env.DATABASE_URL = "postgres://example";
  const service = new BossService();
  await service.start();
  let finish!: () => void;
  stopMock.mockReset().mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const first = service.onModuleDestroy();
  const second = service.onModuleDestroy();
  await Promise.resolve();
  expect(stopMock).toHaveBeenCalledOnce();
  finish();
  await Promise.all([first, second]);
  await expect(service.enqueue("queue", {})).rejects.toThrow("Queue is shutting down");
});


it("fails queue startup when required lookup indexes cannot be verified", async () => {
  process.env.DATABASE_URL = "postgres://example";
  stopMock.mockReset().mockResolvedValue(undefined);
  ensureIndexesMock.mockReset().mockResolvedValueOnce({ rows: [{ ready: false }] });
  const service = new BossService();
  await expect(service.start()).rejects.toThrow("Queue lookup indexes are unavailable");
  await service.onModuleDestroy();
});
