import { expect, it, vi } from "vitest"
import { parseEntryFormatUpdate } from "@server/api/v1/entries/entry-formats"
import { EntriesService } from "@server/api/v1/entries/entries.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each(["text", "image", "audio", "video", "link"])("does not reintroduce the retired %s format through Entry saving", async format => {
  const prisma = { entry: { findUnique: vi.fn().mockResolvedValue({
    id: 1, user_id: 2, room_id: 3, source_entry_id: 99, status: "draft", format: "mixed_media", updated_at: new Date(),
  }), update: vi.fn() }, $transaction: vi.fn() }
  const service = withTestDependencies(new EntriesService(), {
    prisma, circleAccess: { resolve: vi.fn().mockResolvedValue({ kind: "member", canWriteWall: true }) },
  })
  await expect(service.saveContent(1, 2, { type: "doc", content: [] }, undefined, undefined, undefined, format))
    .rejects.toThrow("Unsupported post format")
  expect(prisma.$transaction).not.toHaveBeenCalled()
  expect(prisma.entry.update).not.toHaveBeenCalled()
})

it("defaults to the document format and rejects every retired explicit type", () => {
  expect(parseEntryFormatUpdate(undefined, "mixed_media")).toBe("mixed_media")
  expect(parseEntryFormatUpdate("mixed_media", "mixed_media")).toBe("mixed_media")
  for (const format of ["text", "image", "audio", "video", "link"]) {
    expect(() => parseEntryFormatUpdate(format, format)).toThrow("Unsupported post format")
  }
})
