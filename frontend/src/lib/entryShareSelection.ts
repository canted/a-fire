import type { EntryFormat, EntryFormatData } from "../contracts/entryFormats";
import { materialDocument } from "./materialDocument";
import { plainTextFromTiptap, type TiptapDoc, type TiptapNode } from "./tiptap";

export type EntryShareFeedback = {
  id: number;
  originalRoomId: number | null;
  /** All inherited feedback origins; a wrapper never removes room restrictions. */
  originalRoomIds?: number[];
  sourceSharedEntryId?: number | null;
  sourceReplyId?: number | null;
  sourceAuthorId?: number | null;
  /** Set by the server after checking the original context and private copy. */
  authorized: boolean;
  content: TiptapDoc;
  format?: EntryFormat;
  format_data?: EntryFormatData | null;
  authorName: string;
};

export type EntryShareSource = {
  /** Opaque server revision covering content, framing, metadata and feedback snapshots. */
  revision: string;
  content: TiptapDoc;
  format?: EntryFormat;
  format_data?: EntryFormatData | null;
  intent?: string | null;
  question?: string | null;
  lyrics?: string | null;
  feedback?: EntryShareFeedback[];
};

export type EntryShareUnit = {
  id: string;
  kind: "title" | "body" | "media" | "feedback";
  content: TiptapDoc;
  eligible: boolean;
  unavailableReason?: "different-room" | "source-unavailable";
  feedbackId?: number;
  authorName?: string;
  title?: string;
};
export type EntryShareManifest = { revision: string; units: EntryShareUnit[] };
export type EntryShareSelection = { revision: string; unitIds: string[] };
export type SelectedEntryShare = {
  content: TiptapDoc;
  format: "mixed_media";
  format_data: { title?: string };
  /** Kept separate so the server copies each reply through its own snapshot owner. */
  feedback: EntryShareFeedback[];
};

export class EntryShareSelectionError extends Error {
  constructor(public readonly code: "stale" | "invalid" | "ineligible" | "empty", message: string) {
    super(message);
    this.name = "EntryShareSelectionError";
  }
}

const mediaTypes = new Set(["image", "audio", "video"]);
const doc = (content: TiptapNode[]): TiptapDoc => ({ type: "doc", content });
const paragraph = (text: string): TiptapNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const text = (value?: string | null) => value?.trim() || "";

function meaningfulMedia(node: TiptapNode): boolean {
  const attrs = node.attrs;
  if (node.type === "image") return typeof attrs?.src === "string" && Boolean(attrs.src.trim());
  const id = attrs?.[node.type === "audio" ? "audioAssetId" : "videoAssetId"];
  return (typeof id === "number" || typeof id === "string") && Number.isInteger(Number(id)) && Number(id) > 0;
}

function meaningfulDocument(content: TiptapDoc): boolean {
  const visit = (node: TiptapNode): boolean => mediaTypes.has(node.type)
    ? meaningfulMedia(node) : Boolean(node.content?.some(visit));
  return Boolean(plainTextFromTiptap(content) || content.content?.some(visit));
}

/** Presentation and selection share this normalization; private source objects stay unchanged. */
function normalize(source: EntryShareSource) {
  if (!source.revision) throw new EntryShareSelectionError("invalid", "The source revision is required");
  const normalized = clone(materialDocument(source));
  const title = text(source.intent) || text(source.format_data?.title);
  const existingText = plainTextFromTiptap(normalized);
  if (text(source.question) && !existingText.includes(text(source.question))) normalized.content = [paragraph(text(source.question)), ...(normalized.content || [])];
  if (text(source.lyrics) && !plainTextFromTiptap(normalized).includes(text(source.lyrics))) normalized.content = [...(normalized.content || []), paragraph(text(source.lyrics))];

  const media: Array<{ id: string; node: TiptapNode; path: string }> = [];
  const occurrences = new Map<string, number>();
  const count = (node: TiptapNode) => {
    if (mediaTypes.has(node.type) && typeof node.attrs?.nodeId === "string" && node.attrs.nodeId) {
      const id = node.attrs.nodeId;
      occurrences.set(id, (occurrences.get(id) || 0) + 1);
    }
    node.content?.forEach(count);
  };
  normalized.content?.forEach(count);
  const split = (node: TiptapNode, path: string): TiptapNode[] => {
    if (mediaTypes.has(node.type)) {
      if (meaningfulMedia(node)) {
        const nodeId = node.attrs?.nodeId;
        const identity = typeof nodeId === "string" && occurrences.get(nodeId) === 1
          ? `node:${encodeURIComponent(nodeId)}` : `path:${path}`;
        media.push({ id: `media:${identity}`, node, path });
      }
      return [];
    }
    const children = node.content?.flatMap((child, index) => split(child, `${path}.${index}`));
    if (children && !children.length && !node.text) return [];
    return [{ ...node, ...(children ? { content: children } : {}) }];
  };
  const body = doc((normalized.content || []).flatMap((node, index) => split(node, String(index))));
  return { title, body, media, normalized };
}

export function buildEntryShareManifest(source: EntryShareSource, destinationRoomId: number): EntryShareManifest {
  if (!Number.isInteger(destinationRoomId) || destinationRoomId <= 0) throw new EntryShareSelectionError("invalid", "Choose a room");
  const { title, body, media } = normalize(source);
  const units: EntryShareUnit[] = [];
  if (title) units.push({ id: "title", kind: "title", title, content: doc([paragraph(title)]), eligible: true });
  if (meaningfulDocument(body)) units.push({ id: "body", kind: "body", content: body, eligible: true });
  for (const item of media) units.push({ id: item.id, kind: "media", content: doc([item.node]), eligible: true });
  const feedbackIds = new Set<number>();
  for (const feedback of source.feedback || []) {
    if (!Number.isInteger(feedback.id) || feedback.id <= 0 || feedbackIds.has(feedback.id)) throw new EntryShareSelectionError("invalid", "Feedback identities must be unique");
    feedbackIds.add(feedback.id);
    const content = clone(materialDocument(feedback));
    const available = feedback.authorized && meaningfulDocument(content);
    const sameRoom = feedback.originalRoomId === destinationRoomId &&
      (feedback.originalRoomIds || []).every(roomId => roomId === destinationRoomId);
    units.push({ id: `feedback:${feedback.id}`, kind: "feedback", feedbackId: feedback.id, authorName: feedback.authorName, content,
      eligible: available && sameRoom,
      ...(!available ? { unavailableReason: "source-unavailable" as const } : !sameRoom ? { unavailableReason: "different-room" as const } : {}),
    });
  }
  return { revision: source.revision, units };
}

/** Only identifiers cross the selection boundary. Never accept replacement source text. */
export function selectEntryShare(source: EntryShareSource, destinationRoomId: number, selection: EntryShareSelection): SelectedEntryShare {
  if (selection.revision !== source.revision) throw new EntryShareSelectionError("stale", "This entry changed. Review your selection again");
  const manifest = buildEntryShareManifest(source, destinationRoomId);
  if (!Array.isArray(selection.unitIds) || selection.unitIds.some(id => typeof id !== "string") || new Set(selection.unitIds).size !== selection.unitIds.length) throw new EntryShareSelectionError("invalid", "Choose valid source units");
  const selected = new Set(selection.unitIds);
  for (const id of selected) {
    const unit = manifest.units.find(item => item.id === id);
    if (!unit) throw new EntryShareSelectionError("invalid", "This source unit is unavailable");
    if (!unit.eligible) throw new EntryShareSelectionError("ineligible", "This feedback cannot be shared to this room");
  }
  if (!selected.size) throw new EntryShareSelectionError("empty", "Choose at least one meaningful source unit");
  const { title, media, normalized } = normalize(source);
  const paths = new Set(media.filter(item => selected.has(item.id)).map(item => item.path));
  const filter = (node: TiptapNode, path: string): TiptapNode[] => {
    if (mediaTypes.has(node.type)) {
      if (!paths.has(path)) return [];
      // Legacy format adapters may repeat the entry title on media attributes.
      const attrs = { ...node.attrs };
      for (const key of ["thumbnailUrl", "poster"]) {
        const cover = media.find(item => item.node.type === "image" && item.node.attrs?.src === attrs[key]);
        if (cover && !selected.has(cover.id)) delete attrs[key];
      }
      if (!selected.has("title")) {
        for (const key of ["title", "alt", "name"]) if (attrs[key] === title) delete attrs[key];
      }
      return [{ ...node, attrs }];
    }
    const children = node.content?.flatMap((child, index) => filter(child, `${path}.${index}`));
    if (!selected.has("body")) return children || [];
    if (children && !children.length && !node.text) return [];
    return [{ ...node, ...(children ? { content: children } : {}) }];
  };
  const content = doc((normalized.content || []).flatMap((node, index) => filter(node, String(index))));
  const feedback = clone((source.feedback || []).filter(item => selected.has(`feedback:${item.id}`)));
  return { content, format: "mixed_media", format_data: selected.has("title") && title ? { title } : {}, feedback };
}
