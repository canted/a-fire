import { randomUUID } from "node:crypto"
import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service"

export type WorkerHealthStatus = "ok" | "missing" | "error"
const HEARTBEAT_INTERVAL_MS = 20_000

/** Started explicitly only after all job handlers have registered. Web readers never renew leases. */
@Injectable()
export class WorkerHealthService implements OnModuleDestroy {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService
  private readonly instanceId = randomUUID()
  private readonly logger = new Logger(WorkerHealthService.name)
  private timer?: ReturnType<typeof setTimeout>
  private flight: Promise<void> | null = null
  private stopPromise?: Promise<void>
  private statusFlight: Promise<WorkerHealthStatus> | null = null
  private started = false
  private stopping = false

  async start() {
    if (this.stopping) throw new Error("Worker health is shutting down")
    if (this.started) { await this.flight; return }
    this.started = true
    try { await this.heartbeat(); this.schedule() }
    catch (error) { this.started = false; throw error }
  }

  private heartbeat(): Promise<void> {
    if (this.flight) return this.flight
    this.flight = this.prisma.$transaction(async tx => {
      // These are disposable process leases. Retain no dead-process inventory.
      await tx.$executeRaw`DELETE FROM queue_worker_heartbeats WHERE seen_at < (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 day'`
      await tx.$executeRaw`INSERT INTO queue_worker_heartbeats (instance_id, seen_at)
        VALUES (${this.instanceId}::uuid, clock_timestamp() AT TIME ZONE 'UTC')
        ON CONFLICT (instance_id) DO UPDATE SET seen_at = EXCLUDED.seen_at`
    }, { timeout: 5000 }).finally(() => { this.flight = null })
    return this.flight
  }

  private schedule() {
    if (this.stopping) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.heartbeat().catch(() => {
        this.logger.warn("Worker heartbeat failed; readiness expires unless renewed")
      }).finally(() => this.schedule())
    }, HEARTBEAT_INTERVAL_MS)
    // The shared TypeScript project includes DOM timer types; Node supplies unref.
    ;(this.timer as unknown as { unref?: () => void }).unref?.()
  }

  stop(): Promise<void> {
    this.stopping = true
    if (this.timer) clearTimeout(this.timer)
    this.stopPromise ??= (async () => {
      await this.flight?.catch(() => {})
      if (this.started) await this.prisma.queueWorkerHeartbeat.deleteMany({ where: { instance_id: this.instanceId } }).catch(() => {
        this.logger.warn("Worker heartbeat withdrawal failed; readiness will expire")
      })
    })()
    return this.stopPromise
  }

  onModuleDestroy() { return this.stop() }

  async status(): Promise<WorkerHealthStatus> {
    let timer: ReturnType<typeof setTimeout> | undefined
    // A response timeout does not cancel a driver query. Share the pending read
    // so repeated probes cannot accumulate work while the database is stalled.
    const query = this.statusFlight ??= this.prisma.$queryRaw<Array<{ healthy: boolean }>>`SELECT EXISTS (
      SELECT 1 FROM queue_worker_heartbeats
      WHERE seen_at >= (clock_timestamp() AT TIME ZONE 'UTC') - interval '90 seconds'
    ) AS healthy`.then(rows => rows[0]?.healthy ? "ok" as const : "missing" as const).catch(() => "error" as const).finally(() => { this.statusFlight = null })
    try {
      return await Promise.race([query, new Promise<WorkerHealthStatus>(resolve => {
        timer = setTimeout(() => resolve("error"), 1000)
      })])
    } finally { if (timer) clearTimeout(timer) }
  }
}
