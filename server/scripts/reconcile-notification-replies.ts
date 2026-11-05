import "reflect-metadata"
import { PrismaService } from "../prisma/prisma.service"
import { ensureDatabaseUrl } from "../runtime/env"
import { loadEnv } from "../runtime/loadEnv"
import { parseReplyReferenceArgs, reconcileReplyReferences } from "../notifications/reconcile-reply-references"

async function bootstrap() {
  const options = parseReplyReferenceArgs(process.argv.slice(2))
  loadEnv()
  ensureDatabaseUrl()
  const prisma = new PrismaService()
  try {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(await reconcileReplyReferences(prisma, options)))
  } finally { await prisma.$disconnect() }
}
bootstrap().catch(error => { console.error(error); process.exitCode = 1 })
