import "reflect-metadata"
import { BossService } from "../queue/boss.service"
import { PrismaService } from "../prisma/prisma.service"
import { ensureDatabaseUrl } from "../runtime/env"
import { loadEnv } from "../runtime/loadEnv"
import { parseRecoverPendingMediaArgs, previewPendingMediaRecovery } from "../runtime/recoverPendingMedia"
import { recoverPendingMedia } from "../uploads/media-processing"
async function bootstrap() {
  const options = parseRecoverPendingMediaArgs(process.argv.slice(2))
  loadEnv()
  ensureDatabaseUrl()
  const prisma = new PrismaService(), boss = new BossService()
  try {
    const asset = await previewPendingMediaRecovery(prisma, options.kind, options.assetId)
    let recovery: Awaited<ReturnType<typeof recoverPendingMedia>> = false
    if (options.execute && asset) {
      await boss.start()
      recovery = await recoverPendingMedia(prisma, boss, options.kind, options.assetId, options.before)
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: "pending_media_recovery", dry_run: !options.execute, before: options.before, kind: options.kind, asset, outcome: !asset ? "not_found" : !options.execute ? "preview" : recovery ? "enqueued" : "skipped", recovery }))
  } finally { try { await boss.onModuleDestroy() } finally { await prisma.$disconnect() } }
}
bootstrap().catch(error => { console.error(error); process.exitCode = 1 })
