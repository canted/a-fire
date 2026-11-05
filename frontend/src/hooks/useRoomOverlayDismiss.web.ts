import { useEffect, useRef } from "react";
// Registration follows opening order, so a Wall above details dismisses first.
const layers: Array<() => void> = [];
export function useRoomOverlayDismiss(open: boolean, close: () => void) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    const dismiss = () => latest.current();
    layers.push(dismiss);
    const keydown = (event: KeyboardEvent) => {
      // Nested menus/editors may consume Escape before it reaches this owner.
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        layers.at(-1) !== dismiss
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    window.addEventListener("keydown", keydown);
    return () => {
      const index = layers.indexOf(dismiss);
      if (index >= 0) layers.splice(index, 1);
      window.removeEventListener("keydown", keydown);
    };
  }, [open]);
}
