import { sharedEntryPresentation } from "@server/api/v1/entries/shared-entry-presentation"
import { describe, expect, it, vi } from "vitest"
import { BadRequestException, ForbiddenException } from "@nestjs/common"
import type { PrismaService } from "@server/prisma/prisma.service"
import { assertRoomEntrySource, roomEntryValidationContent } from "@server/api/v1/entries/room-entry-policy"
import { validateEntryPublication, validateRoundEntryContent } from "@server/api/v1/entries/entry-content"
const empty = { type: "doc", content: [] }
const text = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Saved feedback" }] }] }
const feedback = (content = text, room = 7) => ({ source_room_id: room, original_room_ids: [room], content, format: "mixed_media", format_data: null })

describe("Room source publication policy", () => {
  it("rejects room-only drafts with explicit recovery and performs no source lookup", async () => {
    const findFirst = vi.fn()
    await expect(assertRoomEntrySource({ entry: { findFirst } } as unknown as PrismaService, { user_id: 2 })).rejects.toThrow("Save the work in your own project")
    expect(findFirst).not.toHaveBeenCalled()
  })
  it("requires an authored published private source in an owned or accepted collaborative project", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 80 })
    await assertRoomEntrySource({ entry: { findFirst } } as unknown as PrismaService, { user_id: 2, source_entry_id: 80 })
    expect(findFirst).toHaveBeenCalledExactlyOnceWith({ where: { id: 80, user_id: 2, status: "published", creation_origin: "project_material", room_id: null, project: { OR: [{ owner_id: 2 }, { participations: { some: { user_id: 2, status: "accepted" } } }] } }, select: { id: true } })
    findFirst.mockResolvedValue(null)
    await expect(assertRoomEntrySource({ entry: { findFirst } } as unknown as PrismaService, { user_id: 2, source_entry_id: 80 })).rejects.toBeInstanceOf(BadRequestException)
  })
  it("counts explicitly shared feedback as meaningful content without merging its stored copy", () => {
    const post = { room_id: 7, shared_feedback: [feedback()] }
    const before = JSON.stringify(post)
    const content = roomEntryValidationContent(post, empty)
    expect(validateEntryPublication(content, "mixed_media", {}).body).toBe("Saved feedback")
    expect(JSON.stringify(post)).toBe(before)
    expect(empty.content).toEqual([])
  })
  it("does not make a statement-only entry publishable", () => {
    const post = { room_id: 7, room_statement: "Here is my thought", shared_feedback: [] }
    expect(() => validateEntryPublication(roomEntryValidationContent(post, empty), "mixed_media", {})).toThrow("Add a title")
  })
  it("rejects feedback restrictions hidden in immutable inherited provenance", () => {
    expect(() => roomEntryValidationContent({ room_id: 7, source_room_ids: [8], shared_feedback: [] }, text)).toThrow(ForbiddenException)
    expect(() => roomEntryValidationContent({ room_id: 7, shared_feedback: [{ ...feedback(), original_room_ids: [8] }] }, text)).toThrow(ForbiddenException)
    expect(() => roomEntryValidationContent({ room_id: 7, shared_feedback: [feedback(text, 8)] }, text)).toThrow(ForbiddenException)
  })
  it("includes saved feedback in Art cover phase restrictions", () => {
    const image = { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/1" } }] }
    const content = roomEntryValidationContent({ room_id: 7, shared_feedback: [feedback()] }, image)
    expect(() => validateRoundEntryContent({ template_key: "art_before_chorus" }, "round_activity_cover", content, "mixed_media", {})).toThrow("images only")
  })
  it("accepts audio-only saved feedback in an audio response and rejects saved text", () => {
    const activity = { template_key: "art_before_chorus", template_config: { responseFormat: "audio" } }
    const audio = { type: "doc", content: [{ type: "audio", attrs: { audioAssetId: 41 } }] }
    const content = roomEntryValidationContent({ room_id: 7, shared_feedback: [feedback(audio as never)] }, empty)
    expect(validateRoundEntryContent(activity, "round_activity_response", content, "mixed_media", {}).media.has("audio")).toBe(true)
    expect(() => validateRoundEntryContent(activity, "round_activity_response", roomEntryValidationContent({ room_id: 7, shared_feedback: [feedback()] }, audio), "mixed_media", {})).toThrow("audio only")
  })
  it("does not hide legacy metadata attachments inside mixed-media feedback", () => {
    const post = { room_id: 7, shared_feedback: [{ ...feedback(empty as never), format_data: { audio_asset_id: 41 } }] }
    const content = roomEntryValidationContent(post, empty)
    expect(validateEntryPublication(content, "mixed_media", {}).media.has("audio")).toBe(true)
    expect(() => validateRoundEntryContent({ template_key: "art_before_chorus" }, "round_activity_cover", content, "mixed_media", {})).toThrow("images only")
  })

})

it("presents historical feedback provenance with the current API name without exposing the stored alias", () => {
  const result = sharedEntryPresentation({ shared_feedback: [{ ...feedback(), source_post_id: 41 }] });
  expect(result.shared_feedback?.[0]).toMatchObject({ source_shared_entry_id: 41, source_room_id: 7 });
  expect(result.shared_feedback?.[0]).not.toHaveProperty("source_post_id");
});
