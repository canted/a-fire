import { spawnSync } from "node:child_process"

/** Apply the committed baseline; failures require explicit operator review. */
export async function runPrismaMigrateDeploy(): Promise<void> {
  const result = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "server/prisma/schema.prisma"],
    { stdio: "inherit" },
  )
  if (result.error || result.signal || result.status !== 0) {
    throw new Error("Prisma migrate deploy failed")
  }
}
