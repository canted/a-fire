import { expect, it } from 'vitest';
import { containsCarryPoint, decideGestureAxis } from '../../../../frontend/src/lib/roomMemberCarry';
it('keeps scrolling vertical and locks deliberate horizontal carrying', () => {
  expect(decideGestureAxis(null, 2, 2)).toBeNull();
  expect(decideGestureAxis(null, 2, 20)).toBe('y');
  expect(decideGestureAxis('y', 40, 22)).toBe('y');
  expect(decideGestureAxis(null, 20, 2)).toBe('x');
});
it('matches only the measured target bounds including the edge', () => {
  const bounds = { left: 20, right: 60, top: 30, bottom: 50 };
  expect(containsCarryPoint(bounds, 20, 50)).toBe(true);
  expect(containsCarryPoint(bounds, 61, 40)).toBe(false);
});
