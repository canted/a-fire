import "reflect-metadata"
import { spawn, type ChildProcess } from "node:child_process"
import { build } from "esbuild"
import type PgBoss from "pg-boss"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"
import { BossWorkers } from "@server/queue/boss.workers"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each(["before-effect", "after-effect"])("recovers a killed reflection worker %s without duplicate content", async stage => {
  const prisma = new PrismaService()
  const boss = new BossService()
  await boss.start()
  const client = (boss as unknown as { boss: PgBoss }).boss
  const queue = `crash-${crypto.randomUUID()}`
  await client.createQueue(queue)
  const now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@crash.test`, username: "Author", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Room", owner_id: user.id, created_at: now, updated_at: now } })
  const note = await prisma.page.create({ data: { title: "Recovered", room_id: room.id, created_at: now, updated_at: now } })
  await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
  const post = await prisma.entry.create({ data: { user_id: user.id, room_id: room.id, status: "published", published_at: now, created_at: now, updated_at: now } })
  await prisma.document.create({ data: { docable_type: "Post", docable_id: post.id, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Retained once" }] }] }, created_at: now, updated_at: now } })
  const reflection = await prisma.reflection.create({ data: { page_id: note.id, user_id: user.id, reflectable_type: "Post", reflectable_id: post.id, created_at: now, updated_at: now } })
  let child: ChildProcess | undefined
  let exited: Promise<{ code: number | null; signal: string | null }> | undefined
  try {
    const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
      import 'reflect-metadata';
      import { PrismaService } from './server/prisma/prisma.service';
      import { BossService } from './server/queue/boss.service';
      import { BossWorkers } from './server/queue/boss.workers';
      const prisma = new PrismaService();
      const boss = new BossService();
      const worker = new BossWorkers();
      worker.prisma = prisma;
      const hold = () => new Promise(() => {});
      (async () => {
        await boss.work(process.env.CRASH_TEST_QUEUE, async data => {
          if (process.env.CRASH_TEST_STAGE === 'before-effect') { console.log('checkpoint'); await hold(); }
          await worker.handleReflectionApply(data);
          console.log('checkpoint');
          await hold();
        });
      })().catch(error => { console.error(error); process.exit(1); });
    ` }, bundle: true, write: false, platform: "node", format: "esm", packages: "external", external: ["@tiptap/*"] })
    const id = await boss.enqueue(queue, { reflectionId: reflection.id })
    child = spawn(process.execPath, ["--input-type=module", "-e", bundle.outputFiles[0].text], {
      env: { ...process.env, CRASH_TEST_QUEUE: queue, CRASH_TEST_STAGE: stage }, stdio: ["ignore", "pipe", "pipe"],
    })
    let output = "", errors = ""
    child.stdout!.on("data", chunk => { output += String(chunk) })
    child.stderr!.on("data", chunk => { errors += String(chunk) })
    exited = new Promise((resolve, reject) => {
      child!.once("error", reject)
      child!.once("exit", (code, signal) => resolve({ code, signal }))
    })
    await vi.waitFor(() => expect(output, errors).toContain("checkpoint"), { timeout: 8000 })
    child.kill("SIGKILL")
    expect(await exited).toEqual({ code: null, signal: "SIGKILL" })
    const before = await prisma.document.findFirst({ where: { docable_type: "Note", docable_id: note.id } })
    expect(Boolean(before)).toBe(stage === "after-effect")
    const [active] = await prisma.$queryRaw<Array<{ state: string; retry_limit: number; retry_count: number; expire_seconds: number }>>`SELECT state::text, retry_limit, retry_count, EXTRACT(epoch FROM expire_in)::integer AS expire_seconds FROM pgboss.job WHERE id = ${id}::uuid`
    expect(active).toMatchObject({ state: "active", retry_limit: 2, retry_count: 0, expire_seconds: 900 })
    // Advance only this fixture's lease clock; keep production expiry/retry defaults.
    await prisma.$executeRaw`UPDATE pgboss.job SET started_on = now() - expire_in - interval '1 second' WHERE id = ${id}::uuid`
    await client.maintain()
    const [expired] = await prisma.$queryRaw<Array<{ state: string }>>`SELECT state::text FROM pgboss.job WHERE id = ${id}::uuid`
    expect(expired.state).toBe("retry")
    const replacement = withTestDependencies(new BossWorkers(), { prisma })
    await boss.work<{ reflectionId: number }>(queue, data => replacement.handleReflectionApply(data))
    await vi.waitFor(async () => {
      const [row] = await prisma.$queryRaw<Array<{ state: string; retry_count: number }>>`SELECT state::text, retry_count FROM pgboss.job WHERE id = ${id}::uuid`
      expect(row).toMatchObject({ state: "completed", retry_count: 1 })
    }, { timeout: 8000 })
    const saved = await prisma.document.findFirstOrThrow({ where: { docable_type: "Note", docable_id: note.id } })
    const json = JSON.stringify(saved.content)
    expect(json.split("Retained once")).toHaveLength(2)
    expect(json.split('"type":"contentSource"')).toHaveLength(2)
    expect(saved.version).toBe(1)
    if (before) expect(saved).toEqual(before)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    await exited
    await boss.onModuleDestroy()
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name = ${queue}`
    await prisma.$executeRaw`DELETE FROM pgboss.queue WHERE name = ${queue}`
    await prisma.reflection.delete({ where: { id: reflection.id } })
    await prisma.document.deleteMany({ where: { OR: [{ docable_type: "Note", docable_id: note.id }, { docable_type: "Post", docable_id: post.id }] } })
    await prisma.entry.delete({ where: { id: post.id } })
    await prisma.page.delete({ where: { id: note.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
}, 20000)
