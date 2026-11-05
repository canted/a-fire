import { BossService } from "../queue/boss.service"
import { PrismaService } from "../prisma/prisma.service"
import { ensureDatabaseUrl } from "./env"
import { loadEnv } from "./loadEnv"
import { parseRetryFailedMediaArgs, retryFailedMediaAssets, type RetryMediaKind } from "./retryFailedMedia"

export async function runRetryFailedMediaCommand(kind: RetryMediaKind): Promise<void> {
  loadEnv()
  ensureDatabaseUrl()

  const options = parseRetryFailedMediaArgs(process.argv.slice(2))
  const prisma = new PrismaService()
  const boss = new BossService()

  try {
    if (options.execute) await boss.start()
    const result = await retryFailedMediaAssets(prisma, boss, kind, options)
    const rows = result.assets.map((asset) => ({
      id: asset.id,
      title: asset.title,
      created_at: asset.created_at.toISOString(),
      error_message: asset.error_message,
    }))

    // eslint-disable-next-line no-console
    console.table(rows)
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: `retry_failed_${kind}_complete`,
        dry_run: !result.execute,
        matched_count: result.assets.length,
        enqueued_count: result.enqueuedCount,
        next_after_id: result.nextAfterId,
      }),
    )

    if (!result.execute) {
      // eslint-disable-next-line no-console
      console.log(`Dry run only. Re-run with --execute to reset assets and enqueue uploads.${kind} jobs.`)
    }
  } finally {
    try { await boss.onModuleDestroy() } finally { await prisma.$disconnect() }
  }
}

