import { useEffect } from "react";
import type { RefObject } from "react";
import type { TextInput } from "react-native";
import type { ChatAttachment } from "../lib/chatComposition";
import { browserChatFile } from "../lib/chatFiles";
import { getClipboardMediaFiles } from "../lib/clipboardMedia";
export function useReplyPaste(
  input: RefObject<TextInput | null>,
  attach: (file: ChatAttachment) => Promise<void>,
  enabled: boolean,
) {
  useEffect(() => {
    const element = input.current as unknown as HTMLTextAreaElement | null;
    if (!element || !enabled) return;
    const paste = (event: ClipboardEvent) => {
      const file = getClipboardMediaFiles(event, { allowFiles: true })[0];
      if (file) {
        event.preventDefault();
        void attach(browserChatFile(file));
      }
    };
    element.addEventListener("paste", paste);
    return () => { element.removeEventListener("paste", paste); };
  }, [input, attach, enabled]);
}
