import { expect, it } from 'vitest';
const source = '../../../../frontend/src/hooks/useKeyboardFocus.web.ts';
const { installKeyboardFocus } = await import(source);
it('shows field focus for keyboard navigation, clears it on pointer input, and cleans up', () => {
  const dispose = installKeyboardFocus(document);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  expect(document.documentElement.dataset.keyboardFocus).toBe('true');
  document.dispatchEvent(new Event('pointerdown'));
  expect(document.documentElement.dataset.keyboardFocus).toBeUndefined();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
  expect(document.documentElement.dataset.keyboardFocus).toBeUndefined();
  dispose();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  expect(document.documentElement.dataset.keyboardFocus).toBeUndefined();
});
