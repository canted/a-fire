import { expect, it } from 'vitest';
import { isMessageExposed, readingAnchorTop, readingAnchorAtBoundary } from '../../../../frontend/src/lib/messageExposure';

it('keeps a portrait target exposed after the viewport shrinks to landscape', () => {
  const rowHeight = 48;
  const portraitTop = readingAnchorTop(undefined, 700, rowHeight);
  const landscapeTop = readingAnchorTop(portraitTop, 180, rowHeight);
  expect(portraitTop).toBe(326);
  expect(landscapeTop).toBe(132);
  expect(isMessageExposed({ x: 0, y: landscapeTop, width: 300, height: rowHeight }, { x: 0, y: 0, width: 300, height: 180 })).toBe(true);
});
it('preserves visible anchors and handles rows taller than the new viewport', () => {
  expect(readingAnchorTop(60, 700, 48)).toBe(60);
  expect(readingAnchorTop(-80, 180, 400)).toBe(-80);
  expect(readingAnchorTop(-500, 180, 400)).toBe(-220);
  expect(readingAnchorTop(326, 180, 400)).toBe(0);
});

it('preserves a partially clipped top message when returning to the conversation', () => {
  expect(readingAnchorTop(-22, 700, 48)).toBe(-22);
  expect(readingAnchorTop(-60, 700, 48)).toBe(0);
});

it('settles a fully visible newest message when centering would require negative scrolling', () => {
  expect(readingAnchorAtBoundary(0, -119, 4000, 368, 126, 625)).toBe(true);
  expect(readingAnchorAtBoundary(0, -119, 4000, 600, 126, 625)).toBe(false);
  expect(readingAnchorAtBoundary(100, -119, 4000, 368, 126, 625)).toBe(false);
  expect(readingAnchorAtBoundary(4000, 80, 4000, 10, 126, 625)).toBe(true);
});

it('moves forward and inverted lists toward the same visible target', async () => {
  const { readingAnchorCorrection } = await import('../../../../frontend/src/lib/messageExposure');
  expect(readingAnchorCorrection(100, 400, false)).toBe(300);
  expect(readingAnchorCorrection(100, 400, true)).toBe(-300);
  expect(readingAnchorCorrection(100, 100, false)).toBe(0);
});
