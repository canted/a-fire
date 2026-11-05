export type GestureAxis = "x" | "y" | null;
export const SPATIAL_AXIS_LOCK_DISTANCE = 7;
export function decideGestureAxis(
  current: GestureAxis,
  deltaX: number,
  deltaY: number,
): GestureAxis {
  if (current) return current;
  if (Math.hypot(deltaX, deltaY) <= SPATIAL_AXIS_LOCK_DISTANCE) return null;
  return Math.abs(deltaX) >= Math.abs(deltaY) ? "x" : "y";
}

/** Window-space hit testing shared by DOM and native Room member carrying. */
export function containsCarryPoint(bounds: { left: number; top: number; right: number; bottom: number }, x: number, y: number) {
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}
