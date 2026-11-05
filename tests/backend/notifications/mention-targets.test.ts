import { describe, expect, it } from "vitest"
import { extractMentionedUserIds } from "@server/notifications/mention-targets"

describe("extractMentionedUserIds", () => {
  it("returns unique user mention targets from nested Tiptap content", () => {
    const result = extractMentionedUserIds({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { id: "user:4", targetType: "user", targetId: "4" } },
            { type: "mention", attrs: { id: "page:9", targetType: "note", targetId: "9" } },
            { type: "mention", attrs: { id: "user:4", targetType: "user", targetId: "4" } },
          ],
        },
        { type: "blockquote", content: [{ type: "mention", attrs: { id: "user:12" } }] },
      ],
    })

    expect(result).toEqual([4, 12])
  })
})
