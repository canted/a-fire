import type { TiptapDoc, TiptapNode } from "./tiptap";

const textBlocks = new Set(["paragraph", "heading", "codeBlock"]);

import { materialNodeText } from "./materialDocument";
export { materialNodeText } from "./materialDocument";

export function canEditMaterialText(node: TiptapNode): boolean {
  return textBlocks.has(node.type) && (node.content || []).every((child) => child.type === "text" || child.type === "hardBreak");
}

export function materialNodeLabel(node: TiptapNode): string {
  if (canEditMaterialText(node)) return "Text";
  return ({ image: "Image", audio: "Audio", video: "Video", file: "File", pageLink: "Page", contentSource: "Source", bulletList: "List", orderedList: "List", blockquote: "Quotation" } as Record<string, string>)[node.type] || "Material";
}

/** Replace the changed range only, retaining untouched marks and node attributes. */
export function updateMaterialText(node: TiptapNode, text: string): TiptapNode {
  if (!canEditMaterialText(node)) return node;
  const previous = materialNodeText(node);
  if (previous === text) return node;
  let start = 0;
  while (start < previous.length && start < text.length && previous[start] === text[start]) start++;
  let end = previous.length;
  let nextEnd = text.length;
  while (end > start && nextEnd > start && previous[end - 1] === text[nextEnd - 1]) { end--; nextEnd--; }
  const before: TiptapNode[] = [];
  const after: TiptapNode[] = [];
  let offset = 0;
  let insertionMarks: TiptapNode["marks"];
  for (const child of node.content || []) {
    const value = materialNodeText(child);
    const last = offset + value.length;
    if (offset <= start && last >= start && child.type === "text") insertionMarks = child.marks;
    if (offset < start) {
      const prefix = value.slice(0, Math.min(value.length, start - offset));
      if (prefix) before.push(child.type === "hardBreak" ? child : { ...child, text: prefix });
    }
    if (last > end) {
      const suffix = value.slice(Math.max(0, end - offset));
      if (suffix) after.push(child.type === "hardBreak" ? child : { ...child, text: suffix });
    }
    offset = last;
  }
  const replacement = text.slice(start, nextEnd);
  const inserted: TiptapNode[] = node.type === "codeBlock"
    ? (replacement ? [{ type: "text", text: replacement }] : [])
    : replacement.split("\n").flatMap<TiptapNode>((line, index) => [
    ...(index ? [{ type: "hardBreak" }] : []),
    ...(line ? [{ type: "text", text: line, ...(insertionMarks ? { marks: insertionMarks } : {}) }] : []),
  ]);
  return { ...node, content: [...before, ...inserted, ...after] };
}

export function hasProjectMaterial(content?: TiptapDoc | null): boolean {
  const meaningful = (node: TiptapNode): boolean => node.type === "text"
    ? Boolean(node.text?.trim())
    : !["paragraph", "heading", "codeBlock", "hardBreak"].includes(node.type) || Boolean(node.content?.some(meaningful));
  return Boolean(content?.content?.some(meaningful));
}

const renderedNodes = new Set(["text", "paragraph", "heading", "hardBreak", "codeBlock", "bulletList", "orderedList", "listItem", "blockquote", "horizontalRule", "image", "audio", "video", "file", "mention", "audioTimestamp", "pageLink", "contentSource"]);
export function canPreviewMaterialNode(node: TiptapNode): boolean {
  return renderedNodes.has(node.type) && (node.content || []).every(canPreviewMaterialNode);
}

export { materialDocument } from "./materialDocument";

/** Entry composition presents document text in its plain Body field while preserving unknown blocks. */
export function entryBodyText(body: string | null | undefined, content: TiptapDoc): string {
  return [body || '', ...(content.content || []).filter(node => !['image', 'audio', 'video'].includes(node.type) && canPreviewMaterialNode(node)).map(materialNodeText)].filter(Boolean).join('\n\n');
}
export function entryContentAfterBodyEdit(content: TiptapDoc): TiptapDoc {
  return { ...content, content: (content.content || []).filter(node => ['image', 'audio', 'video'].includes(node.type) || !canPreviewMaterialNode(node)) };
}

const entryAttachments = new Set(["image", "audio", "video", "file"]);
const editableEntryBodyNode = (node: TiptapNode) => !entryAttachments.has(node.type) && canPreviewMaterialNode(node);

/** Rich body adapter. Legacy framing moves into the document on the first rich edit. */
export function entryBodyDocument(body: string | null | undefined, content: TiptapDoc): TiptapDoc {
  const framing: TiptapNode[] = body ? [{ type: "paragraph", content: body.split("\n").flatMap<TiptapNode>((line, index) => [
    ...(index ? [{ type: "hardBreak" }] : []),
    ...(line ? [{ type: "text", text: line }] : []),
  ]) }] : [];
  return { ...content, content: [...framing, ...(content.content || []).filter(editableEntryBodyNode)] };
}

/** Retain attachment/unknown blocks verbatim; callers clear the legacy body field after this edit. */
export function entryContentAfterRichBodyEdit(content: TiptapDoc, body: TiptapDoc): TiptapDoc {
  const original = content.content || [];
  const replacement = (body.content || []).filter(node => !entryAttachments.has(node.type));
  const addedAttachments = (body.content || []).filter(node => entryAttachments.has(node.type));
  const lastBodyIndex = original.findLastIndex(editableEntryBodyNode);
  let cursor = 0;
  const nodes = original.flatMap<TiptapNode>((node, index) => {
    if (!editableEntryBodyNode(node)) return [node];
    if (index === lastBodyIndex) return replacement.slice(cursor);
    return cursor < replacement.length ? [replacement[cursor++]] : [];
  });
  if (lastBodyIndex < 0) nodes.push(...replacement);
  // Pasted media joins the attachment tiles in addition order, independent of the text cursor.
  nodes.push(...addedAttachments);
  return { ...content, content: nodes };
}
