import { transitionEntry } from "../lib/entryTransition";
import "../styles/entryTransition.module.css";
import { isRoomNavigation } from "../lib/roomNavigationMotion";
import { usePathname, useRouter } from "expo-router";
import { flushSync } from "react-dom";
import { transitionRoom } from "../lib/roomTransition";
import { markRoomNavigation } from "./useRoomBenchmark";
import "../styles/roomTransition.module.css";
let returnFocus: HTMLElement | null = null;
export function useRoomNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const move = (
    href: string,
    direction: "deeper" | "shallower" | "home",
    action: () => void,
  ) =>
    isRoomNavigation(pathname, href)
      ? transitionRoom(/^\/app\/?$/.test(pathname) ? "from-home" : direction, action, flushSync, href)
      : transitionEntry(pathname, href, action, flushSync);
  const forward = (href: string, action: () => void) => {
    returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    move(href, "deeper", action);
  };
  return {
    ancestor: (href: string) =>
      move(href, "shallower", () => router.dismissTo(href as "/app")),
    returnTo: (fallback: string = "/app") =>
      (() => {
        if (router.canGoBack()) router.back();
        else router.replace(fallback as "/app");
      })(),
    destination: (href: string) =>
      forward(href, () => router.push(href as "/app")),
    thread: (room: string, message: number) =>
      router.push(`/app/rooms/${room}/chat/messages/${message}`),
    save: (room: string, message: number) => {
      returnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      router.push(`/app/rooms/${room}/chat/messages/${message}/save`);
    },
    back: (room: string, message: string) => {
      const leave = () => {
        if (router.canGoBack()) router.back();
        else router.replace(`/app/rooms/${room}/chat?message=${message}`);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const target = returnFocus?.isConnected
              ? returnFocus
              : document
                  .getElementById(`chat-${message}`)
                  ?.querySelector<HTMLElement>('[tabindex="0"]');
            target?.focus({ preventScroll: true });
            returnFocus = null;
          }),
        );
      };
      // A modal dismissal must not send the underlying Chat diagonally away.
      leave();
    },
    source: (room: string, message: string) =>
      router.dismissTo(`/app/rooms/${room}/chat?message=${message}`),
    enter: (id: string) => {
      markRoomNavigation(id);
      return move(`/app/rooms/${id}`, "deeper", () =>
        router.push(`/app/rooms/${id}`),
      );
    },
    parent: (id: string) => {
      markRoomNavigation(id);
      return move(`/app/rooms/${id}`, "shallower", () =>
        router.dismissTo(`/app/rooms/${id}`),
      );
    },
    home: () => move("/app", "home", () => router.dismissTo("/app")),
  };
}
