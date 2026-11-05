import type { Cache, Key } from "swr";

export type InfiniteRegistration = {
  queryKey: Key;
  cacheKey: string;
  update: (updater: any) => Promise<unknown>;
  revalidate: () => Promise<unknown>;
};
// Bound infinite mutations notify the aggregate subscription and revalidate every page.
// Scope registrations to the SWR provider so separate sessions/tests cannot share caches.
const infiniteQueries = new WeakMap<Cache, Set<InfiniteRegistration>>();
export function registrations(cache: Cache) {
  let entries = infiniteQueries.get(cache);
  if (!entries) {
    entries = new Set();
    infiniteQueries.set(cache, entries);
  }
  return entries;
}

