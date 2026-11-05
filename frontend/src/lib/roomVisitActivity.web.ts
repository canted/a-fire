/** Browser activity is explicit input, not polling, socket delivery or an idle tab. */
export function observeRoomVisitActivity(activity: () => void) {
  let last = -Infinity;
  const foreground = () => document.visibilityState === "visible" && document.hasFocus();
  const report = () => {
    // Initial entry must work while Web Inspector or browser chrome has focus.
    // Subsequent renewals still require actual foreground activity.
    const initial = last === -Infinity;
    if (document.visibilityState !== "visible" || (!initial && !foreground()) || Date.now() - last < 60_000) return;
    last = Date.now();
    activity();
  };
  const input = (event: Event) => { if (event.isTrusted) report(); };
  const resume = () => { if (last === -Infinity) report(); else if (foreground()) { last = -Infinity; report(); } };
  for (const event of ["pointerdown", "keydown", "wheel"]) document.addEventListener(event, input, { passive: true });
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("focus", resume);
  report();
  return () => {
    for (const event of ["pointerdown", "keydown", "wheel"]) document.removeEventListener(event, input);
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("focus", resume);
  };
}
