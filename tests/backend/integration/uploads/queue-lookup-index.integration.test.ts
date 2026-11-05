import "reflect-metadata"
import { it, expect } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"

it("verifies the queue lookup index and inherits it for newly created queue partitions", async () => {
  const prisma = new PrismaService(), boss = new BossService(), rollback = new Error("rollback index fixture")
  try {
    await boss.start()
    await prisma.$transaction(async tx => {
      expect(await tx.$queryRaw`SELECT public.afire_ensure_queue_indexes() AS ready`).toEqual([{ ready: true }])
      const name = `test.lookup.${crypto.randomUUID()}`
      await tx.$queryRaw`SELECT pgboss.create_queue(${name}::text, '{}'::json)::text`
      const rows = await tx.$queryRaw<Array<{ valid: boolean; ready: boolean }>>`
        SELECT child.indisvalid AS valid,child.indisready AS ready
        FROM pg_inherits inheritance JOIN pg_index child ON child.indexrelid=inheritance.inhrelid
        JOIN pgboss.queue queue ON child.indrelid=to_regclass('pgboss.' || queue.partition_name)
        WHERE inheritance.inhparent='pgboss.afire_job_name_state_idx'::regclass AND queue.name=${name}
      `
      expect(rows).toEqual([{ valid: true, ready: true }])
      expect(await tx.$queryRaw`SELECT public.afire_ensure_queue_indexes() AS ready`).toEqual([{ ready: true }])
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await boss.onModuleDestroy(); await prisma.$disconnect() }
})

it("refuses an incompatible same-name index instead of treating its name as proof", async () => {
  const prisma = new PrismaService(), rollback = new Error("rollback incompatible index fixture")
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('DROP INDEX pgboss.afire_job_name_state_idx')
      await tx.$executeRawUnsafe('CREATE INDEX afire_job_name_state_idx ON pgboss.job (name, id)')
      await expect(tx.$queryRaw`SELECT public.afire_ensure_queue_indexes()`).rejects.toThrow("incompatible")
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})

it("defers installation while the pg-boss schema is absent", async () => {
  const prisma = new PrismaService(), rollback = new Error("rollback schema fixture")
  try {
    await prisma.$transaction(async tx => {
      // Transactional rename preserves every queue row and is always rolled back.
      const temporary = `queue_fixture_${crypto.randomUUID().replaceAll("-", "")}`
      await tx.$executeRawUnsafe(`ALTER SCHEMA pgboss RENAME TO ${temporary}`)
      expect(await tx.$queryRaw`SELECT public.afire_ensure_queue_indexes() AS ready`).toEqual([{ ready: false }])
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
