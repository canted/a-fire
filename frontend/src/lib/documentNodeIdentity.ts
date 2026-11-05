type IdentifiedNode<T> = { type: string; attrs?: Record<string, unknown>; content?: T[] };
export function findDocumentNode<T extends IdentifiedNode<T>>(nodes: T[] | undefined, id: string): T | undefined {
  for (const node of nodes ?? []) {
    if (node.attrs?.nodeId === id) return node;
    const nested = findDocumentNode(node.content, id);
    if (nested) return nested;
  }
  return undefined;
}
export function audioReplyMarker<T extends IdentifiedNode<T>>(nodes: T[] | undefined): string | undefined {
  for (const node of nodes ?? []) {
    const id = node.attrs?.nodeId;
    if (node.type === 'audioTimestamp' && typeof id === 'string' && /^audio-reply-[\w-]+$/.test(id)) return id;
    const nested = audioReplyMarker(node.content);
    if (nested) return nested;
  }
  return undefined;
}

/** Return the containing top-level block so a deep link includes its surrounding reply. */
export function findDocumentBlock<T extends IdentifiedNode<T>>(nodes: T[] | undefined, id: string): T | undefined {
  return nodes?.find(node => node.attrs?.nodeId === id || Boolean(findDocumentNode(node.content, id)));
}

/** Resolve editor requests by immutable media identity; return native-owned attrs.
 * Tiptap adds schema defaults, so serialized equality is not sufficient. */
export function matchingDocumentNode<T extends IdentifiedNode<T>>(nodes: T[] | undefined, requested: T): T | undefined {
  const keys: Record<string, string[]> = { image: ['src'], audio: ['audioAssetId'], video: ['videoAssetId'], file: ['src'], noteLink: ['noteId', 'pageId'], contentSource: ['sourcePath'] };
  const identity = keys[requested.type];
  for (const node of nodes ?? []) {
    if (node.type === requested.type && identity?.some(key => node.attrs?.[key] != null) && identity.every(key => String(node.attrs?.[key] ?? '') === String(requested.attrs?.[key] ?? '')) && String(node.attrs?.nodeId ?? '') === String(requested.attrs?.nodeId ?? '')) return node;
    const nested = matchingDocumentNode(node.content, requested);
    if (nested) return nested;
  }
  return undefined;
}
