import { useEffect, useRef, useState } from "react";
import { assertImageFile } from "../lib/imageFile";
import { pickChatFile, releaseChatFile } from "../lib/chatFiles";
import type { ChatAttachment } from "../lib/chatComposition";

/** Owns the selected preview and disposes abandoned or replaced picker results. */
export function useImageSelection() {
  const [image, setImage] = useState<ChatAttachment>();
  const selected = useRef<ChatAttachment | undefined>(undefined);
  const mounted = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      releaseChatFile(selected.current);
    };
  }, []);
  async function choose() {
    const attempt = ++generation.current;
    let file: ChatAttachment | undefined;
    try {
      file = await pickChatFile("photo");
      if (!file) return;
      assertImageFile(file);
      if (!mounted.current || attempt !== generation.current) {
        releaseChatFile(file);
        return;
      }
      releaseChatFile(selected.current);
      selected.current = file;
      setImage(file);
    } catch (error) {
      releaseChatFile(file);
      if (mounted.current && attempt === generation.current) throw error;
    }
  }
  function clear() {
    generation.current++;
    releaseChatFile(selected.current);
    selected.current = undefined;
    setImage(undefined);
  }
  return { image, choose, clear };
}
