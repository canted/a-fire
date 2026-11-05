import "reflect-metadata"
import { BossService } from "../queue/boss.service"
import { PrismaService } from "../prisma/prisma.service"
import { ensureDatabaseUrl } from "../runtime/env"
import { loadEnv } from "../runtime/loadEnv"
import { parseRecoverMediaAttemptArgs, previewMediaAttemptRecovery } from "../runtime/recoverMediaAttempt"
import { recoverMediaProcessing } from "../uploads/media-processing"

async function bootstrap() {
  const options = parseRecoverMediaAttemptArgs(process.argv.slice(2))
  loadEnv()
  ensureDatabaseUrl()
  const prisma = new PrismaService(), boss = new BossService()
  try {
    const attempt = await previewMediaAttemptRecovery(prisma, options.attemptId)
    let recovery: Awaited<ReturnType<typeof recoverMediaProcessing>> = false
    if (options.execute && attempt) {
      await boss.start()
      recovery = await recoverMediaProcessing(prisma, boss, options.attemptId, options.before)
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: "media_attempt_recovery", dry_run: !options.execute,
      before: options.before, attempt, outcome: !attempt ? "not_found" : !options.execute ? "preview" : recovery ? "enqueued" : "skipped", recovery }))
  } finally {
    try { await boss.onModuleDestroy() } finally { await prisma.$disconnect() }
  }
}
bootstrap().catch(error => { console.error(error); process.exitCode = 1 })
