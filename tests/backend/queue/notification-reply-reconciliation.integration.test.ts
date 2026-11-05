import "reflect-metadata"
import { PrismaClient } from "@prisma/client"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { build } from "esbuild"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { parseReplyReferenceArgs, reconcileReplyReferences } from "@server/notifications/reconcile-reply-references"

it("previews read-only, links verified historical identities, and preserves unresolved events", async () => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@reference-reconcile.test`, username: "Fixture", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Fixture", created_at: now, updated_at: now } })
  const post = await prisma.entry.create({ data: { user_id: user.id, room_id: room.id, created_at: now, updated_at: now } })
  const reply = await prisma.reply.create({ data: { entry_id: post.id, user_id: user.id, status: "deleted", created_at: now, updated_at: now } })
  const base = { actor_id: user.id, room_id: room.id, entry_id: post.id, created_at: now, updated_at: now }
  const events = await prisma.notificationEvent.createManyAndReturn({ data: [
    { ...base, event_type: "reply_created", payload: { replyId: reply.id, excerpt: "Retained excerpt" } },
    { ...base, event_type: "mention", payload: { excerpt: "Retained mention" }, target_path: `/app/entries/${post.id}#reply-${reply.id}` },
    { ...base, event_type: "reply_created", payload: { replyId: String(reply.id) } },
    { ...base, event_type: "reply_created", payload: { replyId: reply.id }, target_path: `/app/entries/${post.id}#reply-${reply.id + 1}` },
    { ...base, event_type: "reply_created", payload: { replyId: 2147483647 } },
    { ...base, event_type: "mention", payload: {}, target_path: `/app/entries/${post.id}` },
  ] })
  events.sort((a, b) => a.id - b.id)
  const afterId = events[0].id - 1
  const ids = events.map(event => event.id)
  try {
    const bundle = await build({ entryPoints: ["server/scripts/reconcile-notification-replies.ts"], bundle: true, write: false, platform: "node", format: "esm", packages: "external" })
    const readOnlyUrl = new URL(process.env.DATABASE_URL!)
    readOnlyUrl.searchParams.set("options", "-c default_transaction_read_only=on")
    const probe = new PrismaClient({ datasources: { db: { url: readOnlyUrl.toString() } } })
    try { expect(await probe.$queryRaw`SELECT current_setting('transaction_read_only') AS mode`).toEqual([{ mode: "on" }]) }
    finally { await probe.$disconnect() }
    const run = async (execute: boolean) => {
      const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", bundle.outputFiles[0].text, "reconcile", "--after-id", String(afterId), "--limit", "2", ...(execute ? ["--execute"] : [])], {
        timeout: 10000, env: { ...process.env, NODE_ENV: "production", DATABASE_URL: execute ? process.env.DATABASE_URL : readOnlyUrl.toString() },
      })
      return JSON.parse(stdout.trim().split("\n").at(-1)!)
    }
    expect(await run(false)).toMatchObject({ dry_run: true, inspected: 2, counts: { eligible: 2 }, next_after_id: events[1].id })
    expect(await prisma.notificationEvent.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } })).toEqual(events)
    expect(await run(true)).toMatchObject({ dry_run: false, counts: { linked: 2 }, next_after_id: events[1].id })
    await prisma.notificationEvent.updateMany({ where: { id: { in: ids.slice(0, 2) } }, data: { reply_id: null } })
    await Promise.all(Array.from({ length: 6 }, () => reconcileReplyReferences(prisma, { afterId, limit: 2, execute: true })))
    const after = await prisma.notificationEvent.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } })
    expect(after).toEqual(events.map((event, index) => ({ ...event, reply_id: index < 2 ? reply.id : null })))
    expect(await reconcileReplyReferences(prisma, { afterId: events[1].id, limit: 100, execute: true })).toMatchObject({ inspected: 4, counts: { unresolved: 4 }, next_after_id: null })
  } finally {
    await prisma.notificationEvent.deleteMany({ where: { id: { in: ids } } })
    await prisma.reply.delete({ where: { id: reply.id } })
    await prisma.entry.delete({ where: { id: post.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})

it.each([["--limit", "0"], ["--limit", "1001"], ["--after-id", "-1"], ["--after-id", "2147483648"], ["--unknown", "1"]])("rejects invalid reconciliation options %j", (...args) => {
  expect(() => parseReplyReferenceArgs(args)).toThrow()
})
