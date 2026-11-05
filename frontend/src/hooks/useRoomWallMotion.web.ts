import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { flushSync } from "react-dom";
import { useRoomOverlayDismiss } from "./useRoomOverlayDismiss";
import { createWallTransition } from "../lib/wallTransition";
import "../styles/wallTransition.module.css";

/** Preserve the Wall morph while returning focus to either a Chat row or its launcher. */
export function useRoomWallMotion(open: boolean, close: () => void, fallback: RefObject<{ focus(): void } | null>) {
  useRoomOverlayDismiss(open, close);
  const motion = useRef(createWallTransition());
  const opener = useRef<HTMLElement | null>(null);
  const previous = useRef(false);
  useEffect(() => () => motion.current.cancel(), []);
  useLayoutEffect(() => {
    if (open && !previous.current) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && !active.closest('[data-wall-snapshot="panel"]')) opener.current = active;
      else if (!opener.current?.isConnected) opener.current = null;
    } else if (!open && previous.current) {
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
      else fallback.current?.focus();
    }
    previous.current = open;
  }, [open, fallback]);
  return {
    present: open,
    onLayout: undefined,
    style: {},
    transition: (direction: "opening" | "closing", update: () => void) => {
      void motion.current.run(direction, () => flushSync(update));
    },
  };
}
