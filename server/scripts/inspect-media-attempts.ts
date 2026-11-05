import "reflect-metadata"
import { PrismaService } from "../prisma/prisma.service"
import { ensureDatabaseUrl } from "../runtime/env"
import { loadEnv } from "../runtime/loadEnv"
import { inspectMediaAttempts, parseInspectMediaAttemptsArgs } from "../runtime/inspectMediaAttempts"

async function bootstrap() {
  loadEnv()
  ensureDatabaseUrl()
  const options = parseInspectMediaAttemptsArgs(process.argv.slice(2))
  const prisma = new PrismaService()
  try {
    const report = await inspectMediaAttempts(prisma, options)
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report))
  } finally {
    await prisma.$disconnect()
  }
}
bootstrap().catch(error => { console.error(error); process.exitCode = 1 })
