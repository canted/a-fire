import { assertEntryFeedbackRoom, entryFeedbackOrigins, referencedFeedbackOrigins, sharingRevision } from "@server/api/v1/projects/entry-sharing"
import { vi } from "vitest"

it("retains inherited origins independently of visible feedback and rejects malformed provenance", () => {
  expect(entryFeedbackOrigins({ source_room_ids: [4], shared_feedback: [{ source_room_id: 4, original_room_ids: [4, 8] }] })).toEqual([4, 8])
  expect(() => assertEntryFeedbackRoom({ source_room_ids: [4, 8] }, 4)).toThrow("original room")
  expect(() => entryFeedbackOrigins({ source_room_ids: ["4"] })).toThrow("unavailable")
  expect(sharingRevision({ b: 2, a: 1 })).toBe(sharingRevision({ a: 1, b: 2 }))
})

function db() {
  return {
    audioAsset: { findMany: vi.fn().mockResolvedValue([{ source_type: "Post", source_id: 90 }]) },
    videoAsset: { findMany: vi.fn().mockResolvedValue([]) },
    activeStorageAttachment: { findMany: vi.fn().mockResolvedValue([]) },
    project: { findUnique: vi.fn().mockResolvedValue({ owner_id: 2, participations: [] }) },
    entry: { findMany: vi.fn().mockResolvedValue([{ id: 90, project_id: 7, user_id: 2, room_id: null, square_id: null, status: "published", creation_origin: "project_feedback", source_room_id: 4, source_room_ids: [4] }]) },
  }
}

it("inherits restrictions from an authorized saved media owner despite stripped display attribution", async () => {
  const prisma = db()
  expect(await referencedFeedbackOrigins(prisma as any, 40, 2, { type: "audio", attrs: { audioAssetId: 12 } })).toEqual([4])
  prisma.project.findUnique.mockResolvedValue({ owner_id: 3, participations: [] })
  expect(await referencedFeedbackOrigins(prisma as any, 40, 2, { audio_asset_id: 12 })).toEqual([])
})

it("does not assign unrelated private-copy restrictions to an image already owned by the source", async () => {
  const prisma = db()
  prisma.activeStorageAttachment.findMany.mockResolvedValue([{ blob_id: 100, record_id: 40 }, { blob_id: 100, record_id: 90 }])
  expect(await referencedFeedbackOrigins(prisma as any, 40, 2, { type: "image", attrs: { src: "/api/v1/uploads/100" } })).toEqual([])
  expect(prisma.entry.findMany).not.toHaveBeenCalled()
})
