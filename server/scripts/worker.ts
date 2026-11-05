import "reflect-metadata"
import { WorkerHealthService } from "../queue/worker-health.service"
import { NestFactory } from "@nestjs/core"
import { BossWorkerModule } from "../queue/boss-worker.module"
import { ensureDatabaseUrl } from "../runtime/env"
import { installShutdownHandlers } from "../runtime/shutdown"
import { shutdownPosthog } from "../runtime/posthog"
import { BossService } from "../queue/boss.service"
import { loadEnv } from "../runtime/loadEnv"

async function bootstrap(): Promise<void> {
  loadEnv()
  ensureDatabaseUrl()
  const app = await NestFactory.createApplicationContext(BossWorkerModule, { logger: ["error", "warn", "log"] })
  // Nest has finished registering all Boss handlers before advertising readiness.
  await app.get(WorkerHealthService).start()
  installShutdownHandlers(async () => {
    try {
      await app.get(WorkerHealthService).stop()
      // Stop fetching and await running jobs before Nest disconnects Prisma.
      await app.get(BossService).onModuleDestroy()
      await app.close()
    } finally { await shutdownPosthog() }
  })
}

bootstrap().catch(error => { console.error(error); process.exit(1) })
