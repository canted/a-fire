import { describe, expect, it } from "vitest";
import { noticePreviewText } from "../../../../frontend/src/lib/noticePreview";
import type { Notice } from "../../../../frontend/src/lib/api/noticeTypes";
import type { TiptapDoc } from "../../../../frontend/src/lib/tiptap";

const baseNotice: Notice = {
  id: "notice-1",
  type: "post",
  source: "Ada",
  message: "",
  createdAt: new Date("2026-06-16T12:00:00Z"),
  contentSeen: false,
};

function doc(content: TiptapDoc["content"]): TiptapDoc {
  return { type: "doc", content };
}

describe("noticePreviewText", () => {
  it("uses the best available post or reply text", () => {
    expect(
      noticePreviewText({
        ...baseNotice,
        content: doc([{ type: "paragraph", content: [{ type: "text", text: "A post excerpt" }] }]),
      }),
    ).toBe("A post excerpt");

    expect(
      noticePreviewText({
        ...baseNotice,
        type: "reply",
        replyId: "reply-1",
        content: doc([{ type: "paragraph", content: [{ type: "text", text: "Original post" }] }]),
        replyContent: doc([{ type: "paragraph", content: [{ type: "text", text: "Reply excerpt" }] }]),
      }),
    ).toBe("Reply excerpt");
  });

  it("falls back to media descriptions when no text is available", () => {
    expect(
      noticePreviewText({
        ...baseNotice,
        content: doc([{ type: "image", attrs: { src: "/image.png" } }]),
      }),
    ).toBe("posted an image");

    expect(
      noticePreviewText({
        ...baseNotice,
        content: doc([{ type: "audio", attrs: { audioAssetId: "audio-1" } }]),
      }),
    ).toBe("posted audio");
  });

  it("uses the overlap note for introduction previews", () => {
    expect(
      noticePreviewText({
        ...baseNotice,
        type: "introduction",
        message: "You are both building small performance rituals.",
        content: doc([{ type: "paragraph", content: [{ type: "text", text: "Entry context" }] }]),
      }),
    ).toBe("You are both building small performance rituals.");
  });
});
