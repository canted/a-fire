import "reflect-metadata"
import { it, expect } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { beginMediaProcessing, failMediaProcessing } from "@server/uploads/media-processing"
import { inspectMediaAttempts, parseInspectMediaAttemptsArgs } from "@server/runtime/inspectMediaAttempts"

it("pages unfinished current and superseded attempts without writing or declaring writers dead", async () => {
  const prisma = new PrismaService()
  const blob = await prisma.activeStorageBlob.create({ data: { key: crypto.randomUUID(), filename: "source", byte_size: 1, service_name: "test", created_at: new Date() } })
  try {
    const first = await beginMediaProcessing(prisma, blob.id, "audio")
    const second = await beginMediaProcessing(prisma, blob.id, "audio")
    await failMediaProcessing(prisma, second.id, "finished failure")
    const third = await beginMediaProcessing(prisma, blob.id, "audio")
    await prisma.mediaProcessingAttempt.updateMany({ where: { blob_id: blob.id }, data: { created_at: new Date("1800-01-01T00:00:00Z") } })
    const before = new Date("1800-01-02T00:00:00Z")
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
      const firstPage = await inspectMediaAttempts(tx as unknown as PrismaService, { before, limit: 1 })
      expect(firstPage.attempts).toHaveLength(1)
      expect(firstPage.nextAfterId).toBe(firstPage.attempts[0].id)
      const secondPage = await inspectMediaAttempts(tx as unknown as PrismaService, { before, limit: 1, afterId: firstPage.nextAfterId! })
      expect(secondPage.nextAfterId).toBeNull()
      return [...firstPage.attempts, ...secondPage.attempts]
    })
    expect(result.map(row => row.id).sort()).toEqual([first.id, third.id].sort())
    expect(result.find(row => row.id === first.id)).toMatchObject({ state: "superseded", current_generation: 3, is_current_generation: false, writer_status: "unknown" })
    expect(result.find(row => row.id === third.id)).toMatchObject({ state: "processing", is_current_generation: true, writer_status: "unknown" })
    expect(await prisma.mediaProcessingAttempt.count({ where: { blob_id: blob.id, finished_at: null } })).toBe(2)
  } finally {
    await prisma.activeStorageBlob.delete({ where: { id: blob.id } })
    await prisma.$disconnect()
  }
})

it.each([["--limit", "0"], ["--limit", "1001"], ["--before", "invalid"], ["--after-id", "invalid"], ["--execute"], ["--unknown", "value"]])("rejects invalid inspection arguments %j", (...args) => {
  expect(() => parseInspectMediaAttemptsArgs(args)).toThrow()
})
