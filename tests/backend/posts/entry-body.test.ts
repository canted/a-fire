import { expect, it } from "vitest"
import { DEFAULT_TIPTAP_DOC, entryBody } from "@server/api/v1/entries/post-content"

it("keeps an explicit empty Document authoritative", () => {
  const document = { type: "doc", content: [] }
  expect(entryBody(document)).toBe(document)
})
it("preserves the authoritative structured Document", () => {
  const document = { type: "doc", content: [{ type: "paragraph", content: [] }] }
  expect(entryBody(document)).toEqual(document)
})
it.each([undefined, null])("uses the canonical empty body when no Document exists (%#)", document => {
  expect(entryBody(document)).toBe(DEFAULT_TIPTAP_DOC)
})
