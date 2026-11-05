import { useReloadBlocker } from "./useReloadBlocker";
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  createContentDraft,
  type ContentDraftOptions,
} from "../lib/contentDraft";
/** React Native adapter to the canonical serialized content draft owner. */
export function useContentDraft(options: ContentDraftOptions) {
  const ref = useRef<ReturnType<typeof createContentDraft> | null>(null);
  if (!ref.current) ref.current = createContentDraft(options);
  const draft = ref.current;
  draft.configure(options);
  const state = useSyncExternalStore(
    draft.subscribe,
    draft.snapshot,
    draft.snapshot,
  );
  useReloadBlocker(state.dirty || state.status === "saving");
  useEffect(() => {
    draft.seed(options.initialContent, options.initialVersion);
  }, [draft, options.initialContent, options.initialVersion]);
  useEffect(() => () => draft.dispose(), [draft]);
  return {
    ...state,
    handleChange: draft.change,
    markDirty: draft.markDirty,
    saveNow: draft.saveNow,
    waitForPendingSave: draft.waitForPendingSave,
    reset: draft.reset,
  };
}
