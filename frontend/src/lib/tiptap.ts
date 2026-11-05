export type TiptapMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: TiptapMark[];
};

export type TiptapDoc = {
  type: "doc";
  content?: TiptapNode[];
};

export const defaultTiptapDoc: TiptapDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [] }],
};

export function hasTiptapNodeType(doc: TiptapDoc | null | undefined, nodeType: string): boolean {
  if (!doc?.content) return false;
  const walk = (node: TiptapNode): boolean => {
    if (node.type === nodeType) return true;
    return node.content?.some(walk) ?? false;
  };
  return doc.content.some(walk);
}

export function plainTextFromTiptap(doc?: TiptapDoc | null): string {
  if (!doc?.content) return "";

  const parts: string[] = [];
  const walk = (node: TiptapNode) => {
    if (node.type === "mention") {
      const label = typeof node.attrs?.label === "string" ? node.attrs.label : null;
      const id = typeof node.attrs?.id === "string" ? node.attrs.id : null;
      parts.push(`@${label || id || "mention"}`);
      return;
    }
    if (node.type === "audioTimestamp") {
      const title = typeof node.attrs?.title === "string" && node.attrs.title.trim() ? node.attrs.title : "Audio";
      parts.push(`${title} @ ${formatTiptapAudioSeconds(node.attrs?.seconds)}`);
      return;
    }
    if (node.type === "text" && typeof node.text === "string") {
      parts.push(node.text);
      return;
    }
    node.content?.forEach(walk);
  };
  doc.content.forEach(walk);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function formatTiptapAudioSeconds(value: unknown): string {
  const seconds = typeof value === "number" ? value : Number(value);
  const wholeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
