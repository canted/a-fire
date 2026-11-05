// @vitest-environment jsdom
import { generateHTML, generateJSON } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ContentSourceNode } from "@server/realtime/content-source";

const extensions = [StarterKit, ContentSourceNode];

describe("ContentSourceNode", () => {
  it("parses source attributes through the editor schema", () => {
    const parsed = generateJSON(
      '<div data-content-source="true" data-source-type="Reply" data-source-id="42" data-source-path="/app/entries/10#reply-42" data-author-name="Alice"></div>',
      extensions,
    );

    expect(parsed.content).toEqual([
      expect.objectContaining({
        type: "contentSource",
        attrs: expect.objectContaining({
          sourceType: "Reply",
          sourceId: "42",
          sourcePath: "/app/entries/10#reply-42",
          authorName: "Alice",
        }),
      }),
    ]);
  });

  it("renders source attributes and omits absent values", () => {
    const html = generateHTML({
      type: "doc",
      content: [{ type: "contentSource", attrs: { sourceType: "Post", sourceId: "1", sourcePath: null } }],
    }, extensions);
    const container = document.createElement("div");
    container.innerHTML = html;
    const element = container.firstElementChild;

    expect(element?.tagName).toBe("DIV");
    expect(element?.getAttribute("data-content-source")).toBe("true");
    expect(element?.getAttribute("data-source-type")).toBe("Post");
    expect(element?.getAttribute("data-source-id")).toBe("1");
    expect(element?.hasAttribute("data-source-path")).toBe(false);
    expect(generateJSON(html, extensions).content?.[0]).toMatchObject({
      type: "contentSource",
      attrs: { sourceType: "Post", sourceId: "1", sourcePath: null },
    });
  });
});
