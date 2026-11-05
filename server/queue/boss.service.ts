import PgBoss from "pg-boss"
import { Prisma } from "@prisma/client"
import { Injectable, OnModuleDestroy } from "@nestjs/common"
import { UPLOAD_ORPHAN_PURGE_QUEUE, AUDIO_SPECTRUM_QUEUE, CHAT_EXPIRE_QUEUE, ACTIVITY_NOTIFICATION_QUEUE, INVITE_EMAIL_QUEUE } from "./queue-names"

@Injectable()
export class BossService implements OnModuleDestroy {
  private boss: PgBoss | null = null
  private startPromise: Promise<void> | null = null
  private stopPromise: Promise<void> | null = null
  private stopping = false

  async start(): Promise<void> {
    await this.ensureBoss()
  }

  onModuleDestroy(): Promise<void> {
    this.stopping = true
    this.stopPromise ??= (async () => {
      await this.startPromise
      if (this.boss) {
        await this.boss.stop()
        this.boss = null
      }
      this.startPromise = null
    })()
    return this.stopPromise
  }

  async enqueue<T extends Record<string, unknown>>(
    queue: string,
    data: T,
    options?: PgBoss.SendOptions,
  ): Promise<string | null> {
    await this.ensureBoss()
    if (!this.boss) return null
    return options ? this.boss.send(queue, data, options) : this.boss.send(queue, data)
  }

  async enqueueAfter<T extends Record<string, unknown>>(
    queue: string,
    data: T,
    dueAt: Date,
    options: PgBoss.SendOptions = {},
  ): Promise<string | null> {
    await this.ensureBoss()
    if (!this.boss) return null
    return this.boss.sendAfter(queue, data, options, dueAt)
  }

  /** Queue inserts commit or roll back with the application write. Uses Boss defaults. */
  async enqueueInTransaction(
    transaction: Prisma.TransactionClient,
    queue: string,
    data: Record<string, unknown>,
    options: PgBoss.SendOptions = {},
  ): Promise<string> {
    const id = await this.enqueue(queue, data, {
      ...options,
      db: {
        executeSql: async (text, values) => ({
          rows: await transaction.$queryRawUnsafe<Array<{ id: string }>>(
            text,
            ...values.map((value, index) => {
              // pg-boss's insertJob parameters 10/11 are interval strings on pg's
              // wire. Prisma otherwise binds numeric expiration seconds as bigint,
              // which PostgreSQL cannot cast directly to interval.
              if ((index === 9 || index === 10) && typeof value === "number") return String(value)
              return value !== null && typeof value === "object" && !(value instanceof Date) ? JSON.stringify(value) : value
            }),
          ),
        }),
      },
    })
    if (!id) throw new Error(`Failed to persist ${queue} job`)
    return id
  }

  /** Check retained queue work before an operator allocates replacement work. */
  async hasOutstandingJob(transaction: Prisma.TransactionClient, queue: string, identity: Record<string, unknown>): Promise<boolean> {
    const rows = await transaction.$queryRaw<Array<{ present: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pgboss.job
        WHERE name = ${queue} AND state IN ('created', 'retry', 'active')
          AND data @> ${JSON.stringify(identity)}::jsonb
      ) AS present
    `
    return rows[0]?.present === true
  }

  /** Copied media assets share a blob; outstanding work on any copy owns that work. */
  async hasOutstandingMediaJob(transaction: Prisma.TransactionClient, kind: "audio" | "video", blobId: number): Promise<boolean> {
    const table = kind === "audio" ? Prisma.sql`audio_assets` : Prisma.sql`video_assets`
    const identity = kind === "audio" ? "audioAssetId" : "videoAssetId"
    const queue = kind === "audio" ? "uploads.audio" : "uploads.video"
    const rows = await transaction.$queryRaw<Array<{ present: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1 FROM pgboss.job job JOIN ${table} asset
          ON job.data @> jsonb_build_object(${identity}::text, asset.id)
        WHERE asset.blob_id = ${blobId} AND job.name = ${queue}
          AND job.state IN ('created', 'retry', 'active')
      ) AS present
    `)
    return rows[0]?.present === true
  }

  async cancel(queue: string, jobId: string | string[]): Promise<void> {
    await this.ensureBoss()
    if (!this.boss) return
    if (Array.isArray(jobId)) {
      await this.boss.cancel(queue, jobId)
      return
    }
    await this.boss.cancel(queue, jobId)
  }

  async work<T extends Record<string, unknown>>(queue: string, handler: (data: T) => Promise<void>): Promise<void> {
    await this.ensureBoss()
    if (!this.boss) return
    await this.boss.work(queue, async (jobs) => {
      for (const job of jobs) {
        await handler(job.data as T)
      }
    })
  }

  private async ensureBoss(): Promise<void> {
    if (this.boss) return
    if (this.stopping) throw new Error("Queue is shutting down")
    if (this.startPromise) {
      await this.startPromise
      return
    }

    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for pg-boss")
    }

    const boss = new PgBoss({ connectionString: databaseUrl })
    this.startPromise = (async () => {
      try {
        await boss.start()
        for (const queue of ["notifications.fanout", "notifications.push.delayed", "reflections.apply",
          UPLOAD_ORPHAN_PURGE_QUEUE, AUDIO_SPECTRUM_QUEUE, "uploads.variant", "uploads.audio", "uploads.video", CHAT_EXPIRE_QUEUE, ACTIVITY_NOTIFICATION_QUEUE, INVITE_EMAIL_QUEUE]) {
          await boss.createQueue(queue)
        }
        const indexes = await boss.getDb().executeSql("SELECT public.afire_ensure_queue_indexes() AS ready", [])
        if (indexes.rows[0]?.ready !== true) throw new Error("Queue lookup indexes are unavailable")
        this.boss = boss
      } catch (error) {
        await Promise.resolve(boss.stop()).catch(() => undefined)
        throw error
      } finally {
        this.startPromise = null
      }
    })()
    await this.startPromise
  }
}
