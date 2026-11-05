type DocumentScrollLock = {
  owners: Set<symbol>;
  restore: () => void;
};

const documentLocks = new WeakMap<Document, DocumentScrollLock>();

export function acquireDocumentScrollLock(document: Document, window: Window) {
  const owner = Symbol("document-scroll-lock");
  let lock = documentLocks.get(document);

  if (!lock) {
    const html = document.documentElement;
    const body = document.body;
    const restoreX = window.scrollX;
    const restoreY = window.scrollY;
    const previousHtmlOverflow = html.style.overflow;
    const previousHtmlOverscrollBehavior = html.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscrollBehavior = body.style.overscrollBehavior;
    const canScrollWindow = typeof window.scrollTo === "function" && !("_virtualConsole" in window);

    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    if (canScrollWindow) window.scrollTo(0, 0);

    const handleTouchMove = (event: TouchEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-visual-viewport-scrollable='true']")) return;
      event.preventDefault();
    };
    document.addEventListener("touchmove", handleTouchMove, { passive: false });

    lock = {
      owners: new Set(),
      restore: () => {
        document.removeEventListener("touchmove", handleTouchMove);
        html.style.overflow = previousHtmlOverflow;
        html.style.overscrollBehavior = previousHtmlOverscrollBehavior;
        body.style.overflow = previousBodyOverflow;
        body.style.overscrollBehavior = previousBodyOverscrollBehavior;
        if (canScrollWindow) window.scrollTo(restoreX, restoreY);
      },
    };
    documentLocks.set(document, lock);
  }

  const activeLock = lock;
  activeLock.owners.add(owner);
  return () => {
    activeLock.owners.delete(owner);
    if (activeLock.owners.size) return;
    documentLocks.delete(document);
    activeLock.restore();
  };
}
