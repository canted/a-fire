import { unstable_serialize as serializeInfinite } from "swr/infinite";
import { entryWithdrawalCache } from "../lib/entryWithdrawalCache";
import { useRef, useState } from "react";
import { useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import { client } from "../lib/api";
import type { EntryShow } from "../lib/api/entries";

/** The server owns removal permission; invalidate retained presentations on success. */
export function useEntryWithdrawal(post?: EntryShow) {
  const { cache, mutate } = useSWRConfig();
  const flight = useRef<Promise<boolean> | null>(null);
  const [error, setError] = useState<string>();
  const mutation = useSWRMutation(["entry-withdraw", post?.id], async () => {
    if (!post?.viewer_access?.can_withdraw) throw new Error("This entry cannot be removed by you.");
    return client.post(`/v1/entries/${post.id}/withdraw`, {});
  });
  function withdraw() {
    if (flight.current) return flight.current;
    setError(undefined);
    const pending = mutation.trigger().then(async () => {
      await entryWithdrawalCache(post!.id, {
        evict: matches => mutate(matches, undefined, { revalidate: false }),
      keys: () => cache.keys(),
      get: key => cache.get(key),
      serializeInfinite,
      evictKey: key => mutate(key, undefined, { revalidate: false }),
        refresh: matches => mutate(matches),
      });
      return true;
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Could not remove this entry. Try again.");
      return false;
    }).finally(() => { flight.current = null; });
    flight.current = pending;
    return pending;
  }
  return { available: post?.viewer_access?.can_withdraw === true, busy: mutation.isMutating, error, withdraw };
}
