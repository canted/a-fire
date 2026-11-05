import { describe, expect, it } from "vitest";
import { entryBodyDocument, entryContentAfterRichBodyEdit, canEditMaterialText, canPreviewMaterialNode, materialDocument, materialNodeLabel, materialNodeText, updateMaterialText } from "../../../../frontend/src/lib/materialNodes";
import type { TiptapNode } from "../../../../frontend/src/lib/tiptap";

describe("plain material text editing", () => {
  it("previews file attachments without making their metadata editable as text", () => {
    const file: TiptapNode = { type: "file", attrs: { src: "/api/v1/uploads/91", filename: "notes.txt", size: 12, contentType: "text/plain" } };
    expect(canPreviewMaterialNode(file)).toBe(true);
    expect(materialNodeLabel(file)).toBe("File");
    expect(canEditMaterialText(file)).toBe(false);
    expect(updateMaterialText(file, "replacement")).toBe(file);
  });
  const node: TiptapNode = { type: "heading", attrs: { level: 2, textAlign: "center" }, content: [{ type: "text", text: "Keep ", marks: [{ type: "bold" }] }, { type: "text", text: "this link", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }] };
  it("returns unchanged formatted material verbatim", () => {
    expect(updateMaterialText(node, "Keep this link")).toBe(node);
    expect(materialNodeText(node)).toBe("Keep this link");
  });
  it("retains untouched marks and attributes when editing only part of the text", () => {
    const result = updateMaterialText(node, "Save this link");
    expect(result.type).toBe("heading");
    expect(result.attrs).toEqual(node.attrs);
    expect(result.content?.at(-1)).toEqual(node.content?.at(-1));
    expect(result.content?.[0].marks).toEqual([{ type: "bold" }]);
    expect(materialNodeText(result)).toBe("Save this link");
  });
  it("preserves line breaks and trailing text when inserting a line", () => {
    const result = updateMaterialText(node, "Keep\nthis link");
    expect(materialNodeText(result)).toBe("Keep\nthis link");
    expect(result.content).toContainEqual({ type: "hardBreak" });
    expect(result.content?.at(-1)?.marks).toEqual([{ type: "link", attrs: { href: "https://example.com" } }]);
  });
  it("keeps edited code block line breaks as text so the stored document remains valid", () => {
    const code: TiptapNode = { type: "codeBlock", attrs: { language: "text" }, content: [{ type: "text", text: "line one" }] };
    const result = updateMaterialText(code, "line one\nline two");
    expect(materialNodeText(result)).toBe("line one\nline two");
    expect(result.content?.every(child => child.type === "text")).toBe(true);
    expect(result.attrs).toEqual(code.attrs);
  });
  it("preserves mentions, nested structure and unknown material without flattening", () => {
    const mention: TiptapNode = { type: "paragraph", content: [{ type: "mention", attrs: { id: 1, label: "Alex" } }] };
    const unknown: TiptapNode = { type: "futureMaterial", attrs: { source: "saved" } };
    expect(canEditMaterialText(mention)).toBe(false);
    expect(updateMaterialText(mention, "overwrite")).toBe(mention);
    expect(canPreviewMaterialNode(mention)).toBe(true);
    expect(canPreviewMaterialNode(unknown)).toBe(false);
    expect(updateMaterialText(unknown, "overwrite")).toBe(unknown);
  });
  it("preserves document audio and cover without replacing text or duplicating nodes", () => {
    const image = { type: "image", attrs: { src: "/api/uploads/cover.jpg", alt: "Recording" } };
    const audio = { type: "audio", attrs: { audioAssetId: 3, title: "Recording", status: "ready" } };
    const content = { type: "doc" as const, attrs: { source: "saved" }, content: [node, image, audio] };
    const result = materialDocument({ content, format: "mixed_media", format_data: { image_url: "/other-cover.jpg", audio_asset_id: 9 } });
    expect(result).toBe(content);
    expect(result.content).toEqual([node, image, audio]);
    expect(materialDocument({ content: result })).toBe(result);
  });
  it("preserves independent image dimensions without borrowing from another image", () => {
    const existing = { type: "image", attrs: { src: "/body-image.jpg", width: 1200, height: 600, alt: "Body image" } };
    const cover = { type: "image", attrs: { src: "/cover.jpg", alt: "", title: "" } };
    const content = { type: "doc" as const, content: [existing, cover] };
    expect(materialDocument({ content }).content).toEqual([existing, cover]);
    expect(cover.attrs).not.toHaveProperty("width");
  });

  it("does not restore explicitly removed nodes from stored metadata after conversion", () => {
    const content = { type: "doc" as const, content: [node] };
    expect(materialDocument({ content, format: "mixed_media", format_data: { image_url: "/old-cover.jpg", audio_asset_id: 3 } })).toBe(content);
  });
  it("preserves text and links from the authoritative document", () => {
    const content = { type: "doc" as const, content: [{ type: "paragraph", content: [
      { type: "text", text: "Keep this" },
      { type: "text", text: "A useful reference", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
    ] }] };
    expect(materialDocument({ content })).toBe(content);
    expect(materialNodeText(content)).toBe("Keep thisA useful reference");
  });
});

it("plain entry editing moves visible text to Body without dropping media or unknown blocks", async () => {
  const { entryBodyText, entryContentAfterBodyEdit } = await import("../../../../frontend/src/lib/materialNodes");
  const media = { type: "audio", attrs: { audioAssetId: 7 } };
  const unknown = { type: "futureBlock", attrs: { keep: true } };
  const content = { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text: "Existing text" }] }, media, unknown] };
  expect(entryBodyText("Framing", content)).toBe("Framing\n\nExisting text");
  expect(entryContentAfterBodyEdit(content).content).toEqual([media, unknown]);
  expect(content.content).toHaveLength(3);
});


describe("rich Entry body ownership", () => {
  const paragraph: TiptapNode = { type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: "text", text: "Bold", marks: [{ type: "bold" }] }, { type: "mention", attrs: { id: "7", label: "Room" } }] };
  const image: TiptapNode = { type: "image", attrs: { src: "/private/image" } };
  const file: TiptapNode = { type: "file", attrs: { src: "/private/file", filename: "notes.txt" } };
  const unknown: TiptapNode = { type: "futureBlock", attrs: { retained: true } };
  it("opens rich content without flattening marks, mentions or nested structure", () => {
    const list: TiptapNode = { type: "bulletList", content: [{ type: "listItem", content: [paragraph] }] };
    const original = { type: "doc" as const, content: [image, paragraph, unknown, list, file] };
    const before = structuredClone(original);
    const body = entryBodyDocument(null, original);
    expect(body.content).toEqual([paragraph, list]);
    expect(entryContentAfterRichBodyEdit(original, body).content).toEqual([image, paragraph, unknown, list, file]);
    expect(original).toEqual(before);
  });
  it("moves legacy framing with line breaks into the rich body once", () => {
    const original = { type: "doc" as const, content: [image, paragraph] };
    const opened = entryBodyDocument("First line\nSecond line", original);
    expect(opened.content?.[0]).toEqual({ type: "paragraph", content: [{ type: "text", text: "First line" }, { type: "hardBreak" }, { type: "text", text: "Second line" }] });
    const saved = entryContentAfterRichBodyEdit(original, opened);
    expect(entryBodyDocument(null, saved)).toEqual(opened);
  });
  it("appends pasted media after existing attachments regardless of the body cursor position", () => {
    const audio: TiptapNode = { type: "audio", attrs: { audioAssetId: 7 } };
    const pastedImage: TiptapNode = { type: "image", attrs: { src: "/private/pasted-image" } };
    const pastedVideo: TiptapNode = { type: "video", attrs: { videoAssetId: 8 } };
    const original = { type: "doc" as const, content: [paragraph, image, unknown, audio, file] };
    const pasted = { type: "doc" as const, content: [pastedImage, paragraph, pastedVideo] };
    const saved = entryContentAfterRichBodyEdit(original, pasted);
    expect(saved.content).toEqual([paragraph, image, unknown, audio, file, pastedImage, pastedVideo]);
    expect(entryBodyDocument(null, saved).content).toEqual([paragraph]);
    const nextImage: TiptapNode = { type: "image", attrs: { src: "/private/next-image" } };
    expect(entryContentAfterRichBodyEdit(saved, { type: "doc", content: [nextImage, paragraph] }).content)
      .toEqual([...saved.content!, nextImage]);
    expect(original.content).toEqual([paragraph, image, unknown, audio, file]);
  });
  it("clearing body preserves attachments and unsupported historical blocks", () => {
    const original = { type: "doc" as const, content: [image, paragraph, unknown, file] };
    expect(entryContentAfterRichBodyEdit(original, { type: "doc", content: [] }).content).toEqual([image, unknown, file]);
    expect(entryContentAfterRichBodyEdit({ type: "doc", content: [image] }, { type: "doc", content: [paragraph] }).content).toEqual([image, paragraph]);
  });
});
