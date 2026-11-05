import "reflect-metadata"
import { PrismaService } from "../prisma/prisma.service"
import { ensureDatabaseUrl } from "../runtime/env"
import { loadEnv } from "../runtime/loadEnv"
import { inspectPendingMedia, parsePendingMediaInspectionArgs } from "../runtime/inspectPendingMedia"
async function bootstrap() {
  const options = parsePendingMediaInspectionArgs(process.argv.slice(2))
  loadEnv()
  ensureDatabaseUrl()
  const prisma = new PrismaService()
  try {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(await inspectPendingMedia(prisma, options)))
  } finally { await prisma.$disconnect() }
}
bootstrap().catch(error => { console.error(error); process.exitCode = 1 })
