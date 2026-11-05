import { setTimeout, clearTimeout } from "node:timers";
import { Client } from "pg"

/** Notifications contain IDs only; PostgreSQL emits them only after commit. */
export class CommittedIdChangeListener {
  private client: Client | null = null
  private retry: ReturnType<typeof setTimeout> | undefined
  private stopped = true
  private retryDelay = 1000

  constructor(
    private readonly channel: "afire_note_changes" | "afire_room_changes",
    private readonly applicationName: string,
    private readonly connectionString: string,
    private readonly changed: (id: number) => void,
    private readonly resync: () => void,
    private readonly warn: () => void,
  ) {}

  async start(): Promise<void> {
    this.stopped = false
    await this.connect()
  }

  async stop(): Promise<void> {
    this.stopped = true
    clearTimeout(this.retry)
    this.retry = undefined
    const client = this.client
    this.client = null
    await client?.end().catch(() => {})
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.client) return
    const client = new Client({ connectionString: this.connectionString, connectionTimeoutMillis: 5000, keepAlive: true, keepAliveInitialDelayMillis: 10000, application_name: this.applicationName })
    this.client = client
    const failed = () => {
      if (this.client !== client) return
      this.client = null
      void client.end().catch(() => {})
      if (this.stopped) return
      this.warn()
      this.retry = setTimeout(() => { this.retry = undefined; void this.connect() }, this.retryDelay)
      this.retryDelay = Math.min(this.retryDelay * 2, 30000)
    }
    client.on("error", failed)
    client.on("end", failed)
    client.on("notification", message => {
      if (this.client !== client || this.stopped || message.channel !== this.channel) return
      const id = Number(message.payload)
      if (Number.isSafeInteger(id) && id > 0) this.changed(id)
    })
    try {
      await client.connect()
      await client.query(`LISTEN ${this.channel}`)
      if (this.stopped || this.client !== client) return
      this.retryDelay = 1000
      // LISTEN is active before the snapshot refresh: no reconnect gap remains.
      this.resync()
    } catch { failed() }
  }
}
