import { useEffect, type RefObject } from "react";
import type { TextInput } from "react-native";
import { getClipboardMediaFiles } from "../lib/clipboardMedia";

/** Chat never creates a file: mixed clipboard text keeps its normal insertion. */
export function useChatPaste(input: RefObject<TextInput | null>, enabled: boolean) {
  useEffect(() => {
    const element = input.current as unknown as HTMLTextAreaElement | null;
    if (!element || !enabled) return;
    const paste = (event: ClipboardEvent) => {
      if (getClipboardMediaFiles(event, { allowFiles: true }).length && !event.clipboardData?.getData("text/plain"))
        event.preventDefault();
    };
    const drop = (event: DragEvent) => { if (event.dataTransfer?.files.length) event.preventDefault(); };
    element.addEventListener("paste", paste);
    element.addEventListener("drop", drop);
    return () => { element.removeEventListener("paste", paste); element.removeEventListener("drop", drop); };
  }, [input, enabled]);
}
