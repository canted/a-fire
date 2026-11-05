import { loadTestEnvironment } from "../../server/runtime/test-environment.mjs"

// Run once before backend workers, including direct `pnpm exec vitest` calls.
// The shared loader rejects development targets before migration can connect.
export default async function setupDatabase(): Promise<void> {
  const environment = loadTestEnvironment()
  if (!environment.DATABASE_URL) return // Database-free unit tests remain usable.
  // Prisma loads .env on import; select the test target before that side effect.
  const { runPrismaMigrateDeploy } = await import("../../server/runtime/migrations")
  await runPrismaMigrateDeploy()
}
