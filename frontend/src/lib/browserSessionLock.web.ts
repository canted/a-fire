/** Browser-only coordination; the portable transport does not depend on DOM APIs. */
export async function withBrowserSessionLock<T>(storageKey: string, operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return await navigator.locks.request(`afire.session:${storageKey}`, operation);
  }
  return operation();
}
