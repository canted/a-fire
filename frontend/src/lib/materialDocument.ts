import type { TiptapDoc, TiptapNode } from "./tiptap";
import type { EntryFormat, EntryFormatData } from "../contracts/entryFormats";

export function materialNodeText(node: TiptapNode): string {
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  return node.content?.map(materialNodeText).join("") || "";
}

/** Entry media and body share one authoritative TipTap document. */
export function materialDocument(entry: { content: TiptapDoc; format?: EntryFormat; format_data?: EntryFormatData | null }): TiptapDoc {
  return entry.content;
}

/** Project framing lives outside the stored media document; display it consistently. */
export function materialPresentation(entry: Parameters<typeof materialDocument>[0] & { intent?: string | null; question?: string | null }) {
  const content = materialDocument(entry);
  return {
    content: { ...content, content: [...(entry.question ? [{ type: 'paragraph', content: [{ type: 'text', text: entry.question }] }] : []), ...(content.content || [])] },
    format: 'mixed_media' as const,
    format_data: { ...entry.format_data, title: entry.intent || entry.format_data?.title },
  };
}

/** Display-only emptiness check; never strip meaningful structured nodes or edit the source. */
export function materialNodeHasVisibleContent(node: TiptapNode): boolean {
  if (node.type === "text") return Boolean(node.text?.replace(/[\s\u200B-\u200D\uFEFF]/g, ""));
  if (["image", "audio", "video", "file", "mention", "audioTimestamp", "horizontalRule", "noteLink", "pageLink", "contentSource"].includes(node.type)) return true;
  return node.content?.some(materialNodeHasVisibleContent) ?? false;
}
