import type { TiptapDoc, TiptapNode } from "./tiptap";
import { appRoutes } from "./appRoutes";

export function normalizeAudioSeconds(value: unknown): number {
  const next = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(next) || next < 0) return 0;
  return Number(next.toFixed(1));
}

export function formatAudioTimestamp(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function buildAudioTimestampPath(
  targetPath: string,
  params: { audioAssetId: string | number; audioNodeId?: string | number | null; seconds: number },
) {
  return appRoutes.audioTimestamp(targetPath, {
    audioAssetId: params.audioAssetId,
    audioNodeId: params.audioNodeId ?? undefined,
    seconds: normalizeAudioSeconds(params.seconds),
  });
}

export function buildAudioTimestampParagraph(params: {
  href: string;
  seconds: number;
  prefix?: string;
  audioAssetId?: string | number | null;
  audioNodeId?: string | number | null;
  title?: string | null;
  nodeId?: string | null;
}): TiptapNode {
  return {
    type: "paragraph",
    content: [
      buildAudioTimestampNode(params),
      { type: "text", text: " " },
    ],
  };
}

export function buildAudioTimestampDoc(params: {
  href: string;
  seconds: number;
  prefix?: string;
  audioAssetId?: string | number | null;
  audioNodeId?: string | number | null;
  title?: string | null;
  nodeId?: string | null;
}): TiptapDoc {
  return {
    type: "doc",
    content: [buildAudioTimestampParagraph(params)],
  };
}

export function buildAudioTimestampNode(params: {
  href: string;
  seconds: number;
  prefix?: string;
  audioAssetId?: string | number | null;
  audioNodeId?: string | number | null;
  title?: string | null;
  nodeId?: string | null;
}): TiptapNode {
  const fallbackTitle = params.prefix ?? "Audio";

  return {
    type: "audioTimestamp",
    attrs: {
      audioAssetId: params.audioAssetId ?? audioAssetIdFromHref(params.href) ?? null,
      audioNodeId: params.audioNodeId ?? null,
      sourcePath: params.href,
      title: params.title?.trim() || fallbackTitle,
      seconds: normalizeAudioSeconds(params.seconds),
      nodeId: params.nodeId ?? null,
    },
  };
}

export function buildAudioSourceBlock(params: {
  audioAssetId: string | number;
  audioNodeId?: string | number | null;
  href: string;
  seconds: number;
  nodeId?: string | null;
  prefix?: string;
}): TiptapNode {
  return {
    type: "contentSource",
    attrs: {
      sourceType: "Audio",
      sourceId: params.audioAssetId,
      sourcePath: params.href,
      label: `${params.prefix ?? "Audio"} ${formatAudioTimestamp(params.seconds)}`,
      nodeId: params.nodeId ?? null,
      audioNodeId: params.audioNodeId ?? null,
    },
  };
}

function audioAssetIdFromHref(href: string): string | null {
  try {
    return new URL(href, "http://app.local").searchParams.get("audio");
  } catch {
    return null;
  }
}

/** A source timestamp alone is context, not a reply. */
export function hasAudioReplyContent(doc: TiptapDoc): boolean {
  const meaningful = (node: TiptapNode): boolean => node.type === 'text'
    ? Boolean(node.text?.trim())
    : ['image', 'audio', 'video', 'file', 'mention', 'noteLink', 'pageLink'].includes(node.type) || Boolean(node.content?.some(meaningful));
  return Boolean(doc.content?.some(meaningful));
}

/** Shared URL contract for timestamp navigation in both app runtimes. */
export function audioTimestampTarget(params: URLSearchParams) {
  const id = params.get('audio');
  if (!id || !/^[1-9]\d*$/.test(id)) return null;
  return { audioAssetId: id, seconds: normalizeAudioSeconds(params.get('t')), audioNodeId: params.get('audioNode') || undefined };
}
