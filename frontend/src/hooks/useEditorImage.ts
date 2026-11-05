import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { AppState, Platform } from "react-native";
import useSWRMutation from "swr/mutation";
import { mediaLink } from "../lib/contentLinks";
import { imagePresentation } from "../lib/imagePresentation";
import { IMAGE_UPLOAD_MAX_BYTES } from "../../../types/image-policy";
import { client, apiBaseUrl } from "../lib/api";
import { useSession } from "./useSession";
import type { TiptapNode } from "../lib/tiptap";

/** Authorized image bytes may cross the editor bridge; credentials never do.
 * No settled private image is retained in SWR or a persistent cache. */
export function useEditorImage() {
  const session = useSession();
  const generation = useRef(0);
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const [foreground, setForeground] = useState(
    AppState.currentState !== "background",
  );
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => listener.remove();
  }, []);
  const active = focused && foreground;
  const allowed = useRef(active);
  allowed.current = active;
  useEffect(
    () => () => {
      generation.current++;
    },
    [session.draftScope, active],
  );
  const request = useSWRMutation(
    "editor-image-presentation",
    async (_, { arg }: { arg: TiptapNode }) => {
      const attrs = arg.attrs ?? {};
      const presentation = imagePresentation({
        src: String(attrs.src ?? ""),
        width: Number(attrs.width) || undefined,
        height: Number(attrs.height) || undefined,
        purpose: "content",
      });
      const origin = new URL(apiBaseUrl).origin;
      const uri = mediaLink(presentation.src, origin);
      if (!uri) throw new Error("Image unavailable");
      // The browser uses its same-origin cookie. Public external images must never
      // receive the app's bearer credentials through the native transport.
      if (Platform.OS === "web" || new URL(uri).origin !== origin) return uri;
      const blob = await client.getBlob(uri);
      if (!blob.type.startsWith("image/") || blob.size > IMAGE_UPLOAD_MAX_BYTES)
        throw new Error("Image unavailable");
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === "string"
            ? resolve(reader.result)
            : reject(new Error("Image unavailable"));
        reader.onerror = () => reject(new Error("Image unavailable"));
        reader.readAsDataURL(blob);
      });
    },
    { populateCache: false, revalidate: false },
  );
  const trigger = request.trigger,
    reset = request.reset;
  const load = useCallback(
    async (node: TiptapNode) => {
      if (!allowed.current) throw new Error("This editor is inactive.");
      const version = generation.current;
      try {
        const uri = await trigger(node);
        if (version !== generation.current)
          throw new Error("This editor session ended.");
        return uri;
      } finally {
        reset();
      }
    },
    [trigger, reset],
  );
  return { load, active, epoch: session.epoch };
}
