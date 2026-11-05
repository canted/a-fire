import { Inject, Injectable } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"
import { readCompleteVapidConfigs } from "../../../runtime/vapid"

type HealthPayload = { status: string; db: string; vapid: string }
type LivenessPayload = { status: "ok" }
type DbStatus = "ok" | "error"

const DEFAULT_HEALTH_DB_TIMEOUT_MS = 1_000

@Injectable()
export class HealthService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  live(): LivenessPayload {
    return { status: "ok" }
  }

  async check(): Promise<HealthPayload> {
    const db = await this.dbStatus()
    return { status: db === "ok" ? "ok" : "degraded", db, vapid: this.vapidStatus() }
  }

  private async dbStatus(): Promise<DbStatus> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const query = this.prisma.$queryRaw`SELECT 1`
      .then(() => "ok" as const)
      .catch(() => "error" as const)
    const timeoutResult = new Promise<DbStatus>((resolve) => {
      timeout = setTimeout(() => resolve("error"), resolveHealthDbTimeoutMs())
    })
    const result = await Promise.race([query, timeoutResult])
    if (timeout) clearTimeout(timeout)
    return result
  }

  private vapidStatus() {
    return readCompleteVapidConfigs().length > 0 ? "ok" : "missing"
  }
}

export function resolveHealthDbTimeoutMs(): number {
  const rawValue = process.env.HEALTH_DB_TIMEOUT_MS
  if (!rawValue) return DEFAULT_HEALTH_DB_TIMEOUT_MS
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_HEALTH_DB_TIMEOUT_MS
  return parsed
}
