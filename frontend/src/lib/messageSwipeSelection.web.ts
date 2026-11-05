/** Preserve selections that preceded a gesture, not selection started by that drag. */
export function hasSwipeSelection(): boolean {
  return Boolean(window.getSelection()?.toString());
}
export function clearSwipeSelection(): void {
  window.getSelection()?.removeAllRanges();
}
