type Cache = {
  evict: (matches: (key: unknown) => boolean) => Promise<unknown>;
  keys: () => IterableIterator<string>;
  get: (key: string) => unknown;
  serializeInfinite: (getKey: () => unknown[]) => string;
  evictKey: (key: string) => Promise<unknown>;
  refresh: (matches: (key: unknown) => boolean) => Promise<unknown>;
};

/** Remove withdrawn content before refreshing lists; refresh failure is not a failed mutation. */
export async function entryWithdrawalCache(postId: string | number, cache: Cache) {
  const matches = (key: unknown) => Array.isArray(key)
    && ["post", "post-replies"].includes(String(key[0])) && String(key[1]) === String(postId);
  const aggregates = new Set<string>();
  for (const key of cache.keys()) {
    const state = cache.get(key);
    const logical = state && typeof state === "object" && "_k" in state ? state._k : undefined;
    if (!Array.isArray(logical) || !matches(logical)) continue;
    const aggregate = cache.serializeInfinite(() => logical);
    if (cache.get(aggregate)) aggregates.add(aggregate);
  }
  await cache.evict(matches);
  await Promise.all([...aggregates].map(key => cache.evictKey(key)));
  await Promise.allSettled([cache.refresh(key => Array.isArray(key)
    && ["room-home", "room-history", "board", "room-walls", "room-rounds", "board-activities", "activity", "chat-messages", "posts"].includes(String(key[0])))]);
}
