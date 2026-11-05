/** Browser installation capabilities shared by the two React runtimes. */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};
export const HIDE_INSTALL_KEY = 'pwa.hide_install';
export function detectInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches || (window.navigator as Navigator & { standalone?: boolean }).standalone);
}
export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}
export function readBoolean(key: string): boolean {
  try { return typeof window !== 'undefined' && window.localStorage.getItem(key) === 'true'; } catch { return false; }
}
export function writeBoolean(key: string, value: boolean) {
  try { if (typeof window !== 'undefined') window.localStorage.setItem(key, String(value)); } catch { /* Private browsing may disable persistence. */ }
}
export function observeBrowserInstallation(callbacks: {
  available: (event: BeforeInstallPromptEvent) => void;
  installed: () => void;
  changed: (installed: boolean) => void;
}): () => void {
  if (typeof window === 'undefined') return () => {};
  const media = window.matchMedia?.('(display-mode: standalone)');
  const changed = () => callbacks.changed(detectInstalled());
  const available = (event: Event) => { event.preventDefault(); callbacks.available(event as BeforeInstallPromptEvent); };
  const installed = () => callbacks.installed();
  media?.addEventListener('change', changed);
  window.addEventListener('beforeinstallprompt', available);
  window.addEventListener('appinstalled', installed);
  document.addEventListener('visibilitychange', changed);
  return () => {
    media?.removeEventListener('change', changed);
    window.removeEventListener('beforeinstallprompt', available);
    window.removeEventListener('appinstalled', installed);
    document.removeEventListener('visibilitychange', changed);
  };
}
