/** Browser visibility adapter shared by both React runtimes. */
export function observeVisibilityDwell(node: Element, onVisible: () => void, { dwellMs = 500, threshold = 0.5, reported = { current: false } }: { dwellMs?: number; threshold?: number; reported?: { current: boolean } } = {}) {
  if (typeof IntersectionObserver === "undefined") return;
  let visible = false;
  let timer: number | null = null;
  let observer: IntersectionObserver | undefined;
  let requiredRatio: number | undefined;
  const clippingParents: Array<{ node: Element; x: boolean; y: boolean }> = [];
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const x = /auto|scroll|hidden|clip/.test(style.overflowX);
    const y = /auto|scroll|hidden|clip/.test(style.overflowY);
    if (x || y) clippingParents.push({ node: parent, x, y });
  }
  const foreground = () => document.visibilityState === "visible" && document.hasFocus();

  const clearTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const updateTimer = () => {
    clearTimer();
    if (!visible || reported.current || !foreground()) return;
    timer = window.setTimeout(() => {
      if (!visible || reported.current || !foreground()) return;
      reported.current = true;
      observer?.disconnect();
      resizeObserver?.disconnect();
      onVisible();
    }, dwellMs);
  };

  const observe = () => {
    if (reported.current) return;
    const bounds = node.getBoundingClientRect();
    let availableWidth = window.innerWidth;
    let availableHeight = window.innerHeight;
    for (const parent of clippingParents) {
      const parentBounds = parent.node.getBoundingClientRect();
      if (parent.x) availableWidth = Math.min(availableWidth, parent.node.clientWidth || parentBounds.width);
      if (parent.y) availableHeight = Math.min(availableHeight, parent.node.clientHeight || parentBounds.height);
    }
    // A tall message cannot show half its full area. Require half the area
    // that can actually fit in its clipped viewport, retaining IO's clipping
    // checks so fetched/offscreen messages never qualify.
    const ratio = bounds.width > 0 && bounds.height > 0
      ? threshold * Math.min(bounds.width, availableWidth) * Math.min(bounds.height, availableHeight) / (bounds.width * bounds.height)
      : threshold;
    if (observer && ratio === requiredRatio) return;
    requiredRatio = ratio;
    visible = false;
    clearTimer();
    observer?.disconnect();
    observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting && entry.intersectionRatio > 0 && entry.intersectionRatio >= ratio);
      updateTimer();
    }, { threshold: [0, ratio] });
    observer.observe(node);
  };
  const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(observe);
  resizeObserver?.observe(node);
  for (const parent of clippingParents) resizeObserver?.observe(parent.node);
  document.addEventListener("visibilitychange", updateTimer);
  window.addEventListener("focus", updateTimer);
  window.addEventListener("blur", updateTimer);
  window.addEventListener("resize", observe);
  observe();

  return () => {
    clearTimer();
    observer?.disconnect();
    resizeObserver?.disconnect();
    document.removeEventListener("visibilitychange", updateTimer);
    window.removeEventListener("focus", updateTimer);
    window.removeEventListener("blur", updateTimer);
    window.removeEventListener("resize", observe);
  };
}
