import "reflect-metadata"
import repl from "node:repl"
import { NestFactory } from "@nestjs/core"
import { AppModule } from "../app.module"
import { PrismaService } from "../prisma/prisma.service"
import { ensureDatabaseUrl } from "../runtime/env"
import { loadEnv } from "../runtime/loadEnv"

type ServiceToken<T> = new (...args: never[]) => T

async function bootstrap(): Promise<void> {
  loadEnv()
  ensureDatabaseUrl()

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"],
  })
  const prisma = app.get(PrismaService)

  const server = repl.start({ prompt: "afire> ", useGlobal: false })
  server.context.app = app
  server.context.prisma = prisma
  server.context.getService = <T>(token: ServiceToken<T>): T => app.get(token)

  // eslint-disable-next-line no-console
  console.log("REPL ready: app, prisma, getService() are available.")

  server.on("exit", async () => {
    await app.close()
  })
}

bootstrap()
