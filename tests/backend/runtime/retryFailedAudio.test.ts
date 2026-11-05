import { describe, expect, it, vi } from "vitest"
import {
  parseRetryFailedAudioArgs,
  retryFailedAudioAssets,
  startOfUtcDay,
} from "@server/runtime/retryFailedAudio"

function makePrisma(assets: any[]) {
  const prisma = {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    audioAsset: {
      findMany: vi.fn(async () => assets),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  }
  prisma.$transaction.mockImplementation(callback => callback(prisma))
  return prisma
}

describe("retryFailedAudioAssets", () => {
  it("defaults to a dry run for today's ffmpeg failures", async () => {
    const assets = [
      {
        id: 4, blob_id: 40,
        title: "voice.m4a",
        processing_status: "failed",
        error_message: "spawn ffmpeg ENOENT",
        created_at: new Date("2026-05-07T16:21:20.000Z"),
      },
    ]
    const prisma = makePrisma(assets)
    const boss = { enqueueInTransaction: vi.fn(), hasOutstandingMediaJob: vi.fn().mockResolvedValue(false) }

    const result = await retryFailedAudioAssets(prisma as never, boss, {
      since: new Date("2026-05-07T00:00:00.000Z"),
    })

    expect(prisma.audioAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 101,
        orderBy: [{ id: "asc" }],
        where: expect.objectContaining({
          processing_status: "failed",
          created_at: { gte: new Date("2026-05-07T00:00:00.000Z") },
          error_message: { contains: "ffmpeg" },
        }),
      }),
    )
    expect(prisma.audioAsset.updateMany).not.toHaveBeenCalled()
    expect(boss.enqueueInTransaction).not.toHaveBeenCalled()
    expect(result).toEqual({ assets, enqueuedCount: 0, execute: false, nextAfterId: null })
  })

  it.each([0, -1, 1.5, 1001, Infinity, NaN])("rejects unsafe batch size %s before reading", async limit => {
    const prisma = makePrisma([])
    await expect(retryFailedAudioAssets(prisma as never, { enqueueInTransaction: vi.fn(), hasOutstandingMediaJob: vi.fn().mockResolvedValue(false) }, { limit })).rejects.toThrow("--limit")
    expect(prisma.audioAsset.findMany).not.toHaveBeenCalled()
  })

  it("rejects an inverted date range", () => {
    expect(() => parseRetryFailedAudioArgs(["--since", "2026-05-08", "--until", "2026-05-07"])).toThrow("--until must be later")
  })

  it("skips an asset that no longer matches when claimed", async () => {
    const prisma = makePrisma([{ id: 4, blob_id: 40 }])
    prisma.audioAsset.updateMany.mockResolvedValue({ count: 0 })
    const boss = { enqueueInTransaction: vi.fn(), hasOutstandingMediaJob: vi.fn().mockResolvedValue(false) }
    const result = await retryFailedAudioAssets(prisma as never, boss, { execute: true })
    expect(result.enqueuedCount).toBe(0)
    expect(boss.enqueueInTransaction).not.toHaveBeenCalled()
  })

  it("resets matching assets and enqueues fresh audio jobs when executed", async () => {
    const assets = [
      {
        id: 4, blob_id: 40,
        title: "voice.m4a",
        processing_status: "failed",
        error_message: "spawn ffmpeg ENOENT",
        created_at: new Date("2026-05-07T16:21:20.000Z"),
      },
      {
        id: 5, blob_id: 50,
        title: "reply.m4a",
        processing_status: "failed",
        error_message: "spawn ffmpeg ENOENT",
        created_at: new Date("2026-05-07T16:39:33.000Z"),
      },
    ]
    const prisma = makePrisma(assets)
    const boss = { enqueueInTransaction: vi.fn(), hasOutstandingMediaJob: vi.fn().mockResolvedValue(false) }

    const result = await retryFailedAudioAssets(prisma as never, boss, {
      since: new Date("2026-05-07T00:00:00.000Z"),
      execute: true,
    })

    expect(prisma.audioAsset.updateMany).toHaveBeenCalledTimes(2)
    expect(prisma.audioAsset.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ id: 4, blob_id: 40, processing_status: "failed" }),
        data: expect.objectContaining({
          processing_status: "pending",
          error_message: null,
        }),
      }),
    )
    expect(boss.enqueueInTransaction).toHaveBeenNthCalledWith(1, prisma, "uploads.audio", { audioAssetId: 4 })
    expect(boss.enqueueInTransaction).toHaveBeenNthCalledWith(2, prisma, "uploads.audio", { audioAssetId: 5 })
    expect(result.enqueuedCount).toBe(2)
  })
})

describe("parseRetryFailedAudioArgs", () => {
  it("defaults to the current UTC day and dry-run mode", () => {
    const options = parseRetryFailedAudioArgs([], new Date("2026-05-07T16:21:20.000Z"))

    expect(options).toEqual({
      since: new Date("2026-05-07T00:00:00.000Z"),
      execute: false,
      errorContains: "ffmpeg",
    })
  })

  it("parses execute, date range, error, and limit options", () => {
    const options = parseRetryFailedAudioArgs([
      "--execute",
      "--since",
      "2026-05-07",
      "--until",
      "2026-05-08T12:00:00.000Z",
      "--error-contains",
      "ENOENT",
      "--limit",
      "10",
    ])

    expect(options).toEqual({
      execute: true,
      since: new Date("2026-05-07T00:00:00.000Z"),
      until: new Date("2026-05-08T12:00:00.000Z"),
      errorContains: "ENOENT",
      limit: 10,
    })
  })

  it("can include all failed errors", () => {
    expect(parseRetryFailedAudioArgs(["--all-errors"]).errorContains).toBe("")
  })

  it("computes the start of a UTC day", () => {
    expect(startOfUtcDay(new Date("2026-05-07T23:59:59.999Z"))).toEqual(new Date("2026-05-07T00:00:00.000Z"))
  })
})


it.each([0, -1, 1.5, 2147483648, Infinity, NaN])("rejects invalid recovery cursor %s before reading", async afterId => {
  const prisma = makePrisma([])
  await expect(retryFailedAudioAssets(prisma as never, { enqueueInTransaction: vi.fn(), hasOutstandingMediaJob: vi.fn() }, { afterId })).rejects.toThrow("--after-id")
  expect(prisma.audioAsset.findMany).not.toHaveBeenCalled()
})

it("parses the recovery continuation", () => {
  expect(parseRetryFailedAudioArgs(["--after-id", "42"]).afterId).toBe(42)
})
