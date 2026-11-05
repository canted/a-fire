import { describe, expect, it } from "vitest";
import { firstLinkPreviewUrl } from "../../../../frontend/src/lib/linkPreviewDetection";

describe("firstLinkPreviewUrl", () => {
  it("returns the first external URL from text or link marks", () => {
    const content = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See https://one.example/path#ignored " },
            { type: "text", text: "two", marks: [{ type: "link", attrs: { href: "https://two.example/" } }] },
          ],
        },
      ],
    };

    expect(firstLinkPreviewUrl(content)).toBe("https://one.example/path");
    expect(firstLinkPreviewUrl(content, ["https://one.example/path"])).toBe("https://two.example/");
  });

  it("ignores non-http links", () => {
    const content = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "mail", marks: [{ type: "link", attrs: { href: "mailto:ada@example.com" } }] }],
        },
      ],
    };

    expect(firstLinkPreviewUrl(content)).toBeNull();
  });

  it("trims punctuation that follows bare URLs", () => {
    const content = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Read https://example.com/posts/1)." }],
        },
      ],
    };

    expect(firstLinkPreviewUrl(content)).toBe("https://example.com/posts/1");
  });
});
