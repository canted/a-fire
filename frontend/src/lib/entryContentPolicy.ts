import type { TiptapDoc, TiptapNode } from "./tiptap";
import type { ProjectEntry } from "./api/projectEntries";
import { materialDocument, materialNodeText } from "./materialNodes";

export type EntryContentPolicy = { media: readonly ("image" | "audio" | "video")[]; text: boolean; title?: boolean; requiredMedia?: "image" | "audio" | "video"; allowOtherContent?: boolean };
export const unrestrictedEntry: EntryContentPolicy = { media: ["image", "audio", "video"], text: true, allowOtherContent: true };
export const imageOnlyEntry: EntryContentPolicy = { media: ["image"], text: false, title: false, requiredMedia: "image" };
const containers = new Set(["doc", "paragraph", "heading", "text", "hardBreak", "blockquote", "bulletList", "orderedList", "listItem", "codeBlock", "horizontalRule"]);

export function entryDocumentKinds(content: TiptapDoc) {
  const media = new Set<string>();
  const visit = (node: TiptapNode) => {
    if (node.type === "image" && node.attrs?.src) media.add("image");
    else if (node.type === "audio" && (node.attrs?.audioAssetId || node.attrs?.src)) media.add("audio");
    else if (node.type === "video" && (node.attrs?.videoAssetId || node.attrs?.src)) media.add("video");
    else if (!containers.has(node.type) && !["image", "audio", "video"].includes(node.type)) media.add(node.type);
    if (node.marks?.some(mark => mark.type === "link")) media.add("link");
    node.content?.forEach(visit);
  };
  visit(content);
  return media;
}

/** Reject the entire incompatible entry; never silently strip a private source. */
export function entryMatchesPolicy(entry: Pick<ProjectEntry, "content" | "format" | "format_data" | "intent" | "question" | "lyrics">, policy: EntryContentPolicy) {
  const document = materialDocument(entry);
  const title = entry.intent || entry.format_data?.title || "";
  const body = [entry.question, entry.lyrics, materialNodeText(document)].filter(Boolean).join("\n").trim();
  const media = entryDocumentKinds(document);
  return Boolean(title.trim() || body || media.size) &&
    ((policy.title ?? policy.text) || !title.trim()) && (policy.text || !body) &&
    (policy.allowOtherContent || [...media].every(kind => policy.media.includes(kind as "image" | "audio" | "video"))) &&
    (!policy.requiredMedia || media.has(policy.requiredMedia));
}
