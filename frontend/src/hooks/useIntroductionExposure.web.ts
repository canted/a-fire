import { useEffect, useRef, useState } from "react";
import type { View } from "react-native";
import { observeVisibilityDwell } from "../lib/visibilityDwell";
export function useIntroductionExposure(id: string, onVisible?: () => void) {
  const [node, setNode] = useState<View | null>(null);
  const callback = useRef(onVisible);
  callback.current = onVisible;
  const enabled = Boolean(onVisible);
  useEffect(() => {
    if (!node || !enabled) return;
    return observeVisibilityDwell(node as unknown as Element, () =>
      callback.current?.(),
    );
  }, [node, id, enabled]);
  return setNode;
}
