import { defaultTiptapDoc, type TiptapDoc, type TiptapNode } from './tiptap';
export type ContentDraftOptions = { initialContent: TiptapDoc; initialVersion?: number; onSave?: (content: TiptapDoc, baseVersion?: number) => Promise<number | void> | number | void; autosave?: boolean; autosaveDelayMs?: number; skipInitialSeed?: boolean };
/** Serialized draft persistence shared by both React runtimes. */
export function createContentDraft(initial: ContentDraftOptions) {
  let options = initial;
  let state = { content: initial.initialContent, status: null as string | null, dirty: false };
  let baseVersion = initial.initialVersion;
  let revision = 0, generation = 0, skippedSeed = false;
  let queue: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<typeof state>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const cancelTimer = () => { if (timer) clearTimeout(timer); timer = undefined; };
  const save = (payload: TiptapDoc, savedRevision: number) => {
    if (!options.onSave) return Promise.resolve();
    const writer = options.onSave;
    const savedGeneration = generation;
    const request = (queue ?? Promise.resolve()).catch(() => undefined).then(async () => {
      if (savedGeneration !== generation) throw new Error('Draft changed before saving');
      publish({ status: 'saving' });
      try {
        const savedVersion = await (baseVersion === undefined ? writer(payload) : writer(payload, baseVersion));
        if (savedGeneration !== generation) throw new Error('Draft changed while saving');
        if (typeof savedVersion === "number") baseVersion = savedVersion;
        const dirty = savedRevision !== revision;
        publish({ dirty, status: dirty ? 'dirty' : null });
      } catch (error) {
        if (savedGeneration === generation) publish({ dirty: true, status: error instanceof Error ? error.message : 'Could not save' });
        throw error;
      }
    });
    queue = request;
    const clear = () => { if (queue === request) queue = null; };
    void request.then(clear, clear);
    return request;
  };
  const schedule = () => {
    cancelTimer();
    if (options.autosave !== false && options.onSave && state.dirty) timer = setTimeout(() => { timer = undefined; void save(state.content, revision).catch(() => {}); }, options.autosaveDelayMs ?? 900);
  };
  return {
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    configure(next: ContentDraftOptions) {
      const wasEnabled = options.autosave !== false;
      options = next;
      if (options.autosave === false) cancelTimer();
      else if (!wasEnabled) schedule();
    },
    seed(content: TiptapDoc, version?: number) { if (!state.dirty && !queue) { baseVersion = version; if (content !== state.content) publish({ content }); } },
    // Titles and other framing fields persist with this document but do not
    // change its JSON. They still need revision guards and serialized autosave.
    markDirty() { revision++; publish({ dirty: true, status: 'dirty' }); schedule(); },
    change(content: TiptapDoc) {
      // A bridge flush is a snapshot, not an edit. Preserve errors and revisions
      // when the editor returns the current document with different key order.
      if (sameDocumentValue(content, state.content)) return;
      const ignored = options.skipInitialSeed !== false && !skippedSeed && empty(options.initialContent) && empty(content);
      skippedSeed = true;
      if (ignored) { publish({ content }); return; }
      revision++; publish({ content, dirty: true, status: 'dirty' }); schedule();
    },
    saveNow(content = state.content) {
      cancelTimer();
      if (content !== state.content) revision++;
      publish({ content, dirty: true });
      return save(content, revision);
    },
    // Publication sends the latest document itself; wait for prior revisions
    // without issuing a redundant draft save. Callers suspend autosave first.
    waitForPendingSave() { cancelTimer(); return queue ?? Promise.resolve(); },
    reset(content = options.initialContent ?? defaultTiptapDoc) { baseVersion = options.initialVersion; cancelTimer(); generation++; revision++; skippedSeed = false; publish({ content, dirty: false, status: null }); },
    dispose: cancelTimer,
  };
}
function empty(doc: TiptapDoc) { return !doc.content?.length || doc.content.every(emptyNode); }
function emptyNode(node: TiptapNode): boolean { return node.type === 'paragraph' ? !node.content?.length || node.content.every(emptyNode) : node.type === 'text' && !node.text?.trim(); }

/** Documents contain JSON values; object key order is not document content. */
export function sameDocumentValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameDocumentValue(value, right[index]));
  }
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && sameDocumentValue(a[key], b[key]));
}
