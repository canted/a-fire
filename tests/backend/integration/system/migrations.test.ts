import { beforeEach, describe, expect, it, vi } from "vitest"
import { runPrismaMigrateDeploy } from "@server/runtime/migrations"

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }))
vi.mock("node:child_process", () => ({ spawnSync: spawnSyncMock }))
const args = ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "server/prisma/schema.prisma"]

describe("single-baseline migration deployment", () => {
  beforeEach(() => vi.resetAllMocks())
  it("applies the committed schema with the current Node runtime", async () => {
    spawnSyncMock.mockReturnValue({ status: 0 })
    await runPrismaMigrateDeploy()
    expect(spawnSyncMock).toHaveBeenCalledExactlyOnceWith(process.execPath, args, { stdio: "inherit" })
  })
  it.each([
    { status: 1 },
    { status: null, signal: "SIGTERM" },
    { status: null, error: new Error("spawn failed") },
    { status: 1, stderr: "Database error code: 42P07; relation already exists" },
  ])("stops on %j without resolving or retrying a failed migration", async result => {
    spawnSyncMock.mockReturnValueOnce(result).mockReturnValue({ status: 0 })
    await expect(runPrismaMigrateDeploy()).rejects.toThrow("Prisma migrate deploy failed")
    expect(spawnSyncMock).toHaveBeenCalledExactlyOnceWith(process.execPath, args, { stdio: "inherit" })
  })
})
