import { isRoomNavigation } from "../lib/roomNavigationMotion";
import { useEffect, useRef } from "react";
import { usePathname } from "expo-router";
import { flushSync } from "react-dom";
import {
  transitionRoom,
  roomTransitionActive,
} from "../lib/roomTransition";

/** Intercept browser traversal before Expo Router consumes popstate. */
export function useHistoryMotion() {
  const path = usePathname();
  const entryIndex = () =>
    (window as Window & { navigation?: { currentEntry?: { index: number } } })
      .navigation?.currentEntry?.index;
  const index = useRef(entryIndex());
  const source = useRef(path);
  useEffect(() => {
    source.current = path;
    index.current = entryIndex();
  }, [path]);
  useEffect(() => {
    let replaying = false;
    const traverse = (event: PopStateEvent) => {
      if (replaying || roomTransitionActive() || !document.startViewTransition)
        return;
      const destination = location.pathname;
      if (!isRoomNavigation(source.current, destination)) return;
      event.stopImmediatePropagation();
      const nextIndex = entryIndex();
      const forward =
        nextIndex !== undefined && index.current !== undefined
          ? nextIndex > index.current
          : destination.split("/").length > source.current.split("/").length;
      const direction =
        /^\/app\/?$/.test(destination) ? "home" : /^\/app\/?$/.test(source.current) ? "from-home" : forward ? "deeper" : "shallower";
      transitionRoom(
        direction,
        () => {
          replaying = true;
          try {
            window.dispatchEvent(
              new PopStateEvent("popstate", { state: event.state }),
            );
          } finally {
            replaying = false;
          }
        },
        flushSync,
        destination,
      );
    };
    window.addEventListener("popstate", traverse, true);
    return () => window.removeEventListener("popstate", traverse, true);
  }, []);
}
