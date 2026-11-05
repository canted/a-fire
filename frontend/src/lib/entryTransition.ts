let activeEntryTransition: ViewTransition | undefined;
let entrySequence = 0;

/** Project card-to-page morph. Route adapters own the synchronous commit. */
export function transitionEntry(from: string, to: string, update: () => void, commit: (update: () => void) => void) {
  activeEntryTransition?.skipTransition();
  activeEntryTransition = undefined;
  const sequence = ++entrySequence;
  const clear = () => {
    if (typeof document === 'undefined' || sequence !== entrySequence) return;
    document.querySelectorAll('[data-entry-transition]').forEach(node => node.removeAttribute('data-entry-transition'));
    delete document.documentElement.dataset.entryNavigation;
    activeEntryTransition = undefined;
  };
  const list = /^\/app\/projects\/(\d+)\/?$/;
  const detail = /^\/app\/projects\/(\d+)\/entries\/(\d+)\/?$/;
  const opening = list.exec(from), destination = detail.exec(to);
  const closing = detail.exec(from), parent = list.exec(to);
  const entry = opening && destination && opening[1] === destination[1] ? destination[2] : closing && parent && closing[1] === parent[1] ? closing[2] : undefined;
  if (!entry || typeof document === 'undefined' || !document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { clear(); update(); return; }
  const mark = () => {
    document.querySelectorAll('[data-entry-transition]').forEach(node => node.removeAttribute('data-entry-transition'));
    const target = document.querySelector<HTMLElement>('[data-entry-page]') ?? document.getElementById(`entry-${entry}`);
    target?.setAttribute('data-entry-transition', 'true');
  };
  mark();
  document.documentElement.dataset.entryNavigation = 'true';
  try {
    const transition = document.startViewTransition(() => {
      if (sequence !== entrySequence) return;
      commit(update); mark();
    });
    activeEntryTransition = transition;
    void transition.ready?.catch(() => {});
    void transition.finished.then(clear, clear);
  } catch {
    clear(); update();
  }
}
