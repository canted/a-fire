import { describe, expect, it } from "vitest"
import { normalizeEntrySubjectPayload, postSubjectPersistenceData } from "@server/api/v1/entries/entry-subjects"

describe("post subject JSON previews", () => {
  it("preserves nested JSON preview values for persistence", () => {
    const preview = { title: "Sketch", detail: { tags: ["draft", null], count: 2, ready: false } }
    const subject = normalizeEntrySubjectPayload({ type: "image", key: "/image.png", preview }, null)
    expect(postSubjectPersistenceData(subject).metadata.preview).toEqual(preview)
  })

  it.each([() => "invalid", undefined, NaN, new Date("2026-09-08")])("discards previews containing non-JSON values", (value) => {
    const subject = normalizeEntrySubjectPayload({ type: "image", key: "/image.png", preview: { value } }, null)
    expect(subject.preview).toBeNull()
    expect(postSubjectPersistenceData(subject).metadata.preview).toBeNull()
  })
})
