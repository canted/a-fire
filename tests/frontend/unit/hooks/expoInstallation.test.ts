import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ signedIn: true, path: '/app/profile' }));
vi.mock('../../../../frontend/node_modules/expo-router', () => ({ usePathname: () => state.path }));
vi.mock('../../../../frontend/src/hooks/useSession', () => ({ useSession: () => ({ ready: true, signedIn: state.signedIn }) }));
vi.mock('../../../../frontend/node_modules/react-native', () => ({ Text: 'span', View: 'div', StyleSheet: { create: (value: unknown) => value } }));
vi.mock('../../../../frontend/src/components/Button', async () => {
  const { createElement } = await import('../../../../frontend/node_modules/' + 'react') as typeof import('../../../../frontend/node_modules/@types/react');
  return { Button: ({ children, onPress, disabled }: any) => createElement('button', { onClick: onPress, disabled }, children) };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act, createElement } = await import('../../../../frontend/node_modules/' + 'react') as typeof import('../../../../frontend/node_modules/@types/react');
const { createRoot } = await import('../../../../frontend/node_modules/' + 'react-dom/client') as typeof import('../../../../frontend/node_modules/@types/react-dom/client');
const { InstallationProvider, InstallAppButton } = await import('../../../../frontend/src/features/pwa/Installation.web');
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
async function render() {
  if (!container) { container = document.createElement('div'); document.body.append(container); root = createRoot(container); }
  await act(async () => root.render(createElement(InstallationProvider, null, createElement(InstallAppButton))));
}
function button(text: string) { return [...container.querySelectorAll('button')].find(item => item.textContent === text); }
async function click(text: string) { await act(async () => button(text)!.click()); }
async function offer(outcome: 'accepted' | 'dismissed' = 'dismissed') {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn().mockResolvedValue(undefined), userChoice: Promise.resolve({ outcome, platform: 'web' }) });
  await act(async () => { window.dispatchEvent(event); });
  return event;
}
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); container = undefined as any; window.localStorage.clear(); state.signedIn = true; state.path = '/app/profile'; vi.restoreAllMocks(); });
it('shows a browser offer and consumes it once after dismissal', async () => {
  await render(); const event = await offer();
  expect(event.defaultPrevented).toBe(true);
  expect(button('Install app')).toBeDefined();
  await click('Install app');
  expect(event.prompt).toHaveBeenCalledOnce();
  expect(button('Install app')).toBeUndefined();
  await click('Install A Fire');
  expect(container.textContent).toContain('Open your browser menu');
});
it('persists dismissal but allows opening installation manually', async () => {
  await render(); await offer(); await click('Don’t show again');
  expect(window.localStorage.getItem('pwa.hide_install')).toBe('true');
  await offer(); expect(button('Install app')).toBeUndefined();
  await click('Install A Fire'); expect(button('Install app')).toBeDefined();
});
it('hides the prompt when signed out and when installation completes', async () => {
  state.signedIn = false; await render(); await offer(); expect(button('Install app')).toBeUndefined();
  state.signedIn = true; await render(); expect(button('Install app')).toBeDefined();
  await act(async () => { window.dispatchEvent(new Event('appinstalled')); });
  expect(container.textContent).toBe('A Fire is installed');
});
it('keeps installation available when storage is unavailable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  await render(); await offer(); await click('Don’t show again'); await click('Install A Fire');
  expect(button('Install app')).toBeDefined();
});
it('recovers when the browser rejects a consumed installation event', async () => {
  await render(); const event = await offer(); event.prompt.mockRejectedValue(new Error('expired'));
  await click('Install app');
  expect(container.textContent).toContain('Could not open installation');
  expect(button('Install app')).toBeUndefined();
  expect(button('Got it')).toBeDefined();
});
it('shows Safari instructions without a browser install event', async () => {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone) AppleWebKit Safari/605.1');
  await render(); expect(container.textContent).toContain('Tap Share');
  expect(button('Install app')).toBeUndefined();
});
it('removes installation listeners when its runtime adapter unmounts', async () => {
  await render(); await act(async () => root.unmount());
  const event = new Event('beforeinstallprompt', { cancelable: true });
  window.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
});
