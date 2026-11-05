/** Shared Wall launcher morph; React adapters own committing their state. */
export function createWallTransition() {
  let sequence = 0;
  let active: ViewTransition | undefined;
  const cancel = () => { sequence++; active?.skipTransition(); active = undefined; if (typeof document !== 'undefined') delete document.documentElement.dataset.roomWallTransition; };
  const run = async (direction: 'opening' | 'closing', update: () => void | Promise<void>) => {
    cancel();
    const request = sequence;
    if (typeof document === 'undefined' || !document.startViewTransition || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { await update(); return; }
    const launcher = document.querySelector<HTMLElement>('[data-wall-control="fab"]');
    if (launcher) {
      const bounds = launcher.getBoundingClientRect();
      const transform = getComputedStyle(launcher).transform;
      const offset = !transform || transform === 'none' || typeof DOMMatrixReadOnly !== 'function' ? { m41: 0, m42: 0 } : new DOMMatrixReadOnly(transform);
      document.documentElement.style.setProperty('--room-wall-launcher-x', `${bounds.left - offset.m41}px`);
      document.documentElement.style.setProperty('--room-wall-launcher-y', `${bounds.top - offset.m42}px`);
    }
    document.documentElement.dataset.roomWallTransition = direction;
    let committed = false;
    const commit = async () => { if (request === sequence && !committed) { committed = true; await update(); } };
    try {
      active = document.startViewTransition(commit);
      await active.updateCallbackDone;
      await active.finished.catch(() => {});
    } catch { await commit(); }
    finally { if (request === sequence) { active = undefined; delete document.documentElement.dataset.roomWallTransition; } }
  };
  return { run, cancel };
}
