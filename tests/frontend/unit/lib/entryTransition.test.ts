import { afterEach, expect, it, vi } from 'vitest';
import { transitionEntry } from '../../../../frontend/src/lib/entryTransition';
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });
it('morphs a selected card into its page and cleans the snapshot markers', async () => {
  document.body.innerHTML = '<article id="entry-42"></article>';
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  document.startViewTransition = vi.fn(update => {
    expect(document.getElementById('entry-42')?.hasAttribute('data-entry-transition')).toBe(true);
    void (update as () => void)();
    return { finished } as ViewTransition;
  });
  const update = () => { document.body.innerHTML = '<main data-entry-page="true"><article id="entry-42" data-entry-transition="true"></article></main>'; };
  transitionEntry('/app/projects/7', '/app/projects/7/entries/42', update, fn => fn());
  expect(document.querySelector('main')?.hasAttribute('data-entry-transition')).toBe(true);
  expect(document.querySelectorAll('[data-entry-transition]')).toHaveLength(1);
  finish(); await finished; await Promise.resolve(); await Promise.resolve();
  expect(document.querySelector('[data-entry-transition]')).toBeNull();
});
it('cuts unrelated navigation and reduced-motion entry navigation', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const update = vi.fn(); document.startViewTransition = vi.fn();
  transitionEntry('/app/projects', '/app/projects/7', update, fn => fn());
  transitionEntry('/app/projects/7', '/app/projects/7/entries/42', update, fn => fn());
  expect(update).toHaveBeenCalledTimes(2);
  expect(document.startViewTransition).not.toHaveBeenCalled();
});
it('keeps a replacement transition marked when the interrupted one finishes', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const finishes: Array<() => void> = [];
  const skip = vi.fn();
  document.startViewTransition = vi.fn(update => {
    void (update as () => void)();
    return { ready: Promise.resolve(), finished: new Promise<void>(resolve => finishes.push(resolve)), skipTransition: skip } as unknown as ViewTransition;
  });
  const update = () => { document.body.innerHTML = '<main data-entry-page="true"></main>'; };
  transitionEntry('/app/projects/7', '/app/projects/7/entries/42', update, fn => fn());
  transitionEntry('/app/projects/7', '/app/projects/7/entries/43', update, fn => fn());
  expect(skip).toHaveBeenCalledOnce();
  finishes[0](); await Promise.resolve();
  expect(document.querySelector('[data-entry-transition]')).not.toBeNull();
  finishes[1](); await Promise.resolve();
  expect(document.querySelector('[data-entry-transition]')).toBeNull();
});
it('still navigates if the browser cannot start a transition', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  document.startViewTransition = vi.fn(() => { throw new Error('Unavailable'); });
  const update = vi.fn();
  transitionEntry('/app/projects/7', '/app/projects/7/entries/42', update, fn => fn());
  expect(update).toHaveBeenCalledOnce();
  expect(document.documentElement.dataset.entryNavigation).toBeUndefined();
});
