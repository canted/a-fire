import { afterEach, expect, it, vi } from 'vitest';
import { createChatReadReceipts } from '../../../../frontend/src/lib/chatReadReceipts';
import { isMessageExposed } from '../../../../frontend/src/lib/messageExposure';
import { roomMessageTarget, safeRoomReturn } from '../../../../frontend/src/lib/roomLinks';
afterEach(() => vi.useRealTimers());
it('deduplicates, batches at 100 and flushes actual exposures when leaving', async () => {
  vi.useFakeTimers();
  const save = vi.fn().mockResolvedValue(undefined);
  const batch = createChatReadReceipts(save);
  for (let id = 1; id <= 125; id++) { batch.enqueue(id); batch.enqueue(id); }
  batch.enqueue(-1); batch.enqueue('invalid');
  await vi.advanceTimersByTimeAsync(300);
  expect(save.mock.calls.map(([ids]) => ids.length)).toEqual([100, 25]);
  batch.enqueue(1); batch.enqueue(126); batch.dispose();
  await vi.advanceTimersByTimeAsync(200);
  expect(save.mock.calls.at(-1)?.[0]).toEqual([126]);
});
it('retries failed receipts but stops retrying after disposal', async () => {
  vi.useFakeTimers();
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const batch = createChatReadReceipts(save);
  batch.enqueue(5);
  await vi.advanceTimersByTimeAsync(5150);
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0]).toEqual([5]);
  save.mockRejectedValue(new Error('still offline'));
  batch.enqueue(6);
  batch.dispose();
  await vi.advanceTimersByTimeAsync(15000);
  expect(save).toHaveBeenCalledTimes(3);
});
it('only counts the visible area of an individual message, including tall messages', () => {
  const viewport = { x: 10, y: 100, width: 300, height: 500 };
  expect(isMessageExposed({ x: 10, y: 600, width: 300, height: 100 }, viewport)).toBe(false);
  expect(isMessageExposed({ x: 10, y: 560, width: 300, height: 100 }, viewport)).toBe(false);
  expect(isMessageExposed({ x: 10, y: 550, width: 300, height: 100 }, viewport)).toBe(true);
  expect(isMessageExposed({ x: 10, y: 0, width: 300, height: 2000 }, viewport)).toBe(true);
});
it('preserves valid message targets across sign-in without allowing external redirects', () => {
  expect(roomMessageTarget('#chat-123')).toBe('123');
  expect(roomMessageTarget('chat-123')).toBe('123');
  expect(roomMessageTarget(undefined, '456')).toBe('456');
  expect(roomMessageTarget('#chat-9007199254740993')).toBeNull();
  expect(safeRoomReturn('/app/rooms/2/chat#chat-123')).toBe('/app/rooms/2/chat#chat-123');
  expect(safeRoomReturn('//evil.test')).toBe('/app');
  expect(safeRoomReturn('/app/rooms/2/chat?next=https://evil.test')).toBe('/app');
});
