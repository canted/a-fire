/** Shared browser navigation snapshot controller; React adapters supply commit. */
let activeRoomTransition: ViewTransition | undefined;
let roomTransitionSequence = 0;
let cancelSurfaceWait: (() => void) | undefined;
export const roomTransitionActive = () => Boolean(activeRoomTransition);

export function transitionRoom(
  direction: "deeper" | "shallower" | "home" | "from-home",
  navigateToDestination: () => void | Promise<void>,
  commit: (action: () => void | Promise<void>) => void | Promise<void>,
  destination?: string,
) {
  cancelSurfaceWait?.();
  activeRoomTransition?.skipTransition();
  activeRoomTransition = undefined;
  const sequence = ++roomTransitionSequence;
  if (
    typeof document === "undefined" ||
    typeof document.startViewTransition !== "function" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    if (typeof document !== "undefined") {
      delete document.documentElement.dataset.roomDetailsTransition;
    }
    navigateToDestination();
    return;
  }

  const root = document.documentElement;
  root.dataset.roomDetailsTransition = direction;
  const cleanUp = () => {
    if (sequence === roomTransitionSequence) {
      delete root.dataset.roomDetailsTransition;
      activeRoomTransition = undefined;
    }
  };
  try {
    const transition = document.startViewTransition(async () => {
      if (sequence === roomTransitionSequence) {
        await commit(navigateToDestination);
        if (destination && sequence === roomTransitionSequence) await waitForRoomSurface(destination);
      }
    });
    activeRoomTransition = transition;
    void transition.ready.catch(() => {});
    void transition.finished.then(cleanUp, cleanUp);
  } catch {
    cleanUp();
    navigateToDestination();
  }
}

/** Wait only for the destination shell (including its skeleton) to mount.
 * Network content never gates motion; the bound protects delayed route bundles. */
function waitForRoomSurface(destination: string): Promise<void> {
  const path = destination.split(/[?#]/)[0].replace(/\/$/, "");
  const ready = () => location.pathname.replace(/\/$/, "") === path &&
    Array.from(document.querySelectorAll<HTMLElement>("[data-room-navigation-ready]"))
      .some(node => node.dataset.roomNavigationReady === path);
  if (ready()) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => {
      observer.disconnect();
      clearTimeout(timer);
      if (cancelSurfaceWait === finish) cancelSurfaceWait = undefined;
      resolve();
    };
    const observer = new MutationObserver(() => { if (ready()) finish(); });
    const timer = setTimeout(finish, 1800);
    cancelSurfaceWait = finish;
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-room-navigation-ready"] });
  });
}
