import "reflect-metadata"
import type PgBoss from "pg-boss"
import { expect, it, vi } from "vitest"
import { BossService } from "@server/queue/boss.service"
import { PrismaService } from "@server/prisma/prisma.service"

it("waits for an active Boss job to persist before worker dependencies close", async () => {
  const prisma = new PrismaService()
  const boss = new BossService()
  await boss.start()
  const queue = `shutdown-${crypto.randomUUID()}`
  const client = (boss as unknown as { boss: PgBoss }).boss
  await client.createQueue(queue)
  const now = new Date()
  const note = await prisma.page.create({ data: { title: "Before", created_at: now, updated_at: now } })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let started = false
  let stopping: Promise<void> | undefined
  try {
    await boss.work(queue, async () => {
      started = true
      await gate
      await prisma.page.update({ where: { id: note.id }, data: { title: "Completed before shutdown" } })
    })
    const job = await boss.enqueue(queue, {})
    await vi.waitFor(() => expect(started).toBe(true), { timeout: 5000 })
    let stopped = false
    stopping = boss.onModuleDestroy().then(() => { stopped = true })
    expect(stopped).toBe(false)
    release()
    await stopping
    expect((await prisma.page.findUniqueOrThrow({ where: { id: note.id } })).title).toBe("Completed before shutdown")
    const rows = await prisma.$queryRaw<Array<{ state: string }>>`SELECT state::text FROM pgboss.job WHERE id = ${job}::uuid`
    expect(rows[0].state).toBe("completed")
    await expect(boss.enqueue(queue, {})).rejects.toThrow("Queue is shutting down")
  } finally {
    release()
    await stopping
    await boss.onModuleDestroy()
    // A separate connection owns test-fixture cleanup after the worker pool closes.
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name = ${queue}`
    await prisma.$executeRaw`DELETE FROM pgboss.queue WHERE name = ${queue}`
    await prisma.page.delete({ where: { id: note.id } })
    await prisma.$disconnect()
  }
}, 15000)
