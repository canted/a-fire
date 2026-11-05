// @vitest-environment jsdom
import { generateHTML, generateJSON } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { PageLinkNode } from "@server/realtime/page-link";

const extensions = [StarterKit, PageLinkNode];

describe("PageLinkNode", () => {
  it.each([
    '<div data-note-link="true" data-note-id="42"></div>',
    '<div data-page-link="true" data-page-id="42"></div>',
  ])("parses current and legacy link markup: %s", (html) => {
    expect(generateJSON(html, extensions).content).toEqual([
      { type: "noteLink", attrs: { noteId: "42" } },
    ]);
  });

  it("renders canonical note markup and preserves the linked ID", () => {
    const html = generateHTML({
      type: "doc",
      content: [{ type: "noteLink", attrs: { noteId: 42 } }],
    }, extensions);
    const container = document.createElement("div");
    container.innerHTML = html;
    const element = container.firstElementChild;

    expect(element?.tagName).toBe("DIV");
    expect(element?.getAttribute("data-note-link")).toBe("true");
    expect(element?.getAttribute("data-note-id")).toBe("42");
    expect(element?.hasAttribute("data-page-id")).toBe(false);
    expect(generateJSON(html, extensions).content).toEqual([
      { type: "noteLink", attrs: { noteId: "42" } },
    ]);
  });

  it("omits the note ID attribute when the link has no destination", () => {
    const html = generateHTML({ type: "doc", content: [{ type: "noteLink", attrs: { noteId: null } }] }, extensions);
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.firstElementChild?.hasAttribute("data-note-id")).toBe(false);
    expect(generateJSON(html, extensions).content).toEqual([
      { type: "noteLink", attrs: { noteId: null } },
    ]);
  });
});
