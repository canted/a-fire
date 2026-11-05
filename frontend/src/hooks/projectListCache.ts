import type { Cache } from "swr";
import { registrations } from "../lib/infiniteQueryRegistry";

/** Bound mutations notify the infinite aggregate and revalidate every loaded page. */
export function revalidateProjectLists(cache: Cache) {
  const lists = new Map([...registrations(cache)]
    .filter(entry => Array.isArray(entry.queryKey) && entry.queryKey[0] === "projects")
    .map(entry => [entry.cacheKey, entry]));
  return Promise.all([...lists.values()].map(entry => entry.revalidate()));
}
