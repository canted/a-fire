import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ load: vi.fn(), importMigration: vi.fn(), migrate: vi.fn() }))
vi.mock("../../../server/runtime/test-environment.mjs", () => ({ loadTestEnvironment: mocks.load }))
vi.mock("../../../server/runtime/migrations", () => {
  mocks.importMigration()
  return { runPrismaMigrateDeploy: mocks.migrate }
})
import setupDatabase from "../setup-database"

beforeEach(() => { vi.resetAllMocks() })

describe("backend suite database preparation", () => {
  it("applies committed migrations after validating the selected target", async () => {
    mocks.load.mockReturnValue({ DATABASE_URL: "postgres://localhost/afire_test" })
    await setupDatabase()
    expect(mocks.importMigration).toHaveBeenCalledOnce()
    expect(mocks.load.mock.invocationCallOrder[0]).toBeLessThan(mocks.importMigration.mock.invocationCallOrder[0])
    expect(mocks.migrate).toHaveBeenCalledOnce()
    expect(mocks.load.mock.invocationCallOrder[0]).toBeLessThan(mocks.migrate.mock.invocationCallOrder[0])
  })
  it("never migrates when isolation validation fails", async () => {
    mocks.load.mockImplementation(() => { throw new Error("Refusing to run tests") })
    await expect(setupDatabase()).rejects.toThrow("Refusing to run tests")
    expect(mocks.migrate).not.toHaveBeenCalled()
  })
  it("stops the suite if preparation fails rather than running against stale tables", async () => {
    mocks.load.mockReturnValue({ DATABASE_URL: "postgres://localhost/afire_test" })
    mocks.migrate.mockRejectedValue(new Error("migration failed"))
    await expect(setupDatabase()).rejects.toThrow("migration failed")
  })
  it("allows database-free unit runs without connecting", async () => {
    mocks.load.mockReturnValue({})
    await setupDatabase()
    expect(mocks.migrate).not.toHaveBeenCalled()
  })
})
