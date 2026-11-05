import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.useRealTimers(); });
it('loads and formats Chat timestamps when the native runtime lacks RelativeTimeFormat', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T18:00:00Z'));
  const nativeIntl = Object.create(Intl);
  Object.defineProperty(nativeIntl, 'RelativeTimeFormat', { value: undefined });
  vi.stubGlobal('Intl', nativeIntl);
  vi.resetModules();
  const { formatChatTimestamp } = await import('../../../../frontend/src/lib/time');
  expect(formatChatTimestamp(new Date('2026-10-15T17:30:00Z'))).toBe(new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date('2026-10-15T17:30:00Z')));
  expect(formatChatTimestamp(new Date('2026-10-13T18:00:00Z'))).toBe('2d');
});
