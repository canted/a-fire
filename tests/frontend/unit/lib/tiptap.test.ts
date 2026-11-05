import { defaultTiptapDoc, hasTiptapNodeType, plainTextFromTiptap } from "../../../../frontend/src/lib/tiptap";

describe("tiptap helpers", () => {
  it("detects node types", () => {
    expect(hasTiptapNodeType(defaultTiptapDoc, "paragraph")).toBe(true);
    expect(hasTiptapNodeType(defaultTiptapDoc, "heading")).toBe(false);
  });

  it("extracts plain text from nested nodes", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello" },
            { type: "text", text: "world" },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "again" }],
        },
      ],
    };

    expect(plainTextFromTiptap(doc)).toBe("Hello world again");
    expect(plainTextFromTiptap(null)).toBe("");
  });

  it("includes inline mention labels in plain text", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hi" },
            { type: "mention", attrs: { id: "user:1", label: "Ada" } },
          ],
        },
      ],
    };

    expect(plainTextFromTiptap(doc)).toBe("Hi @Ada");
  });

  it("includes inline audio timestamp labels in plain text", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "audioTimestamp", attrs: { title: "Bridge idea", seconds: 2.6 } },
            { type: "text", text: "pretty cool" },
          ],
        },
      ],
    };

    expect(plainTextFromTiptap(doc)).toBe("Bridge idea @ 0:02 pretty cool");
  });
});
