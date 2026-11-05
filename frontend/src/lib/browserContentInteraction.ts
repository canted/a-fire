/** Keep embedded controls independent of a surrounding content navigation target. */
export function isContentControl(event: { target: EventTarget | null; currentTarget: EventTarget | null }): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const control = target.closest('button, a, input, select, textarea, video, audio, [role="button"], [role="link"], [role="slider"]');
  return Boolean(control && control !== event.currentTarget);
}
