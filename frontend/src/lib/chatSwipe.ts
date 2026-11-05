/** Shared Chat swipe physics; adapters own pointer/responder arbitration. */
export const REVEAL_OFFSET = 72;
export const COMMIT_OFFSET = REVEAL_OFFSET + 18;
export const MAX_SWIPE_OFFSET = REVEAL_OFFSET + 54;
export function rubberBandSwipeOffset(rawOffset: number) {
  return MAX_SWIPE_OFFSET * (1 - Math.exp(-Math.max(0, rawOffset) / MAX_SWIPE_OFFSET));
}
