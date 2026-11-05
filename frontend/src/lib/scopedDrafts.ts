// Bounded ephemeral UI state. The session cache is the lifetime/identity boundary.
const sessions = new WeakMap<object, Map<string, unknown>>();
const subscriptions = new WeakMap<object, Map<string, Set<() => void>>>();
const pending = new WeakMap<object, Set<string>>();
const pendingListeners = new WeakMap<object, Set<() => void>>();
export function hasPendingScopedDrafts(cache: object) { return Boolean(pending.get(cache)?.size); }
export function subscribePendingScopedDrafts(cache: object, listener: () => void) {
  let group = pendingListeners.get(cache);
  if (!group) { group = new Set(); pendingListeners.set(cache, group); }
  group.add(listener);
  return () => { group.delete(listener); };
}
export function scopedDrafts<T>(cache: object, empty: () => T, isPending?: (value: T) => boolean) {
  let session = sessions.get(cache);
  if (!session) { session = new Map(); sessions.set(cache, session); }
  const store = session;
  let listeners = subscriptions.get(cache);
  if (!listeners) { listeners = new Map(); subscriptions.set(cache, listeners); }
  const observers = listeners;
  let pendingScopes = pending.get(cache);
  if (!pendingScopes) { pendingScopes = new Set(); pending.set(cache, pendingScopes); }
  const retainedPending = pendingScopes;
  const retain = (scope: string, value: T) => {
    store.delete(scope); store.set(scope, value);
    const before = retainedPending.size > 0;
    if (isPending?.(value)) retainedPending.add(scope); else retainedPending.delete(scope);
    if (store.size > 32) { const oldest = store.keys().next().value!; store.delete(oldest); retainedPending.delete(oldest); }
    if (before !== (retainedPending.size > 0)) pendingListeners.get(cache)?.forEach(listener => listener());
  };
  return {
    read(scope: string): T {
      if (!store.has(scope)) retain(scope, empty());
      return store.get(scope) as T;
    },
    subscribe(scope: string, listener: () => void) {
      let group = observers.get(scope);
      if (!group) { group = new Set(); observers.set(scope, group); }
      group.add(listener);
      return () => { group.delete(listener); if (!group.size) observers.delete(scope); };
    },
    write(scope: string, value: T, notify = true) {
      retain(scope, value);
      if (notify) observers.get(scope)?.forEach(listener => listener());
    },
  };
}
