import useSWRInfinite, { unstable_serialize as serializeInfinite } from "swr/infinite";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import useSWR, { SWRConfig, unstable_serialize, useSWRConfig } from "swr";
import { expect, it, vi } from "vitest";
import { entryWithdrawalCache } from "../../../../frontend/src/lib/entryWithdrawalCache";

it("evicts detail and all loaded reply pages while preserving unrelated entries when refresh fails", async () => {
  const cache = new Map();
  const room = vi.fn().mockResolvedValue("room contents");
  const keys = [["post", "41"], ["post", 41, 2], ["post-replies", "41", "cursor"], ["post", "42"]];
  const wrapper = ({ children }: { children: ReactNode }) => <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>;
  const { result } = renderHook(() => {
    useSWR(keys[0], async () => "detail");
    useSWR(keys[1], async () => "detail page");
    useSWRInfinite(index => index < 2 ? ["post-replies", "41", index + 2] : null, async () => "feedback", { initialSize: 2 });
    useSWR(keys[2], async () => "feedback");
    useSWR(keys[3], async () => "other entry");
    useSWR(["room-home", "7"], room);
    const { cache, mutate } = useSWRConfig();
    return () => entryWithdrawalCache(41, {
      evict: matches => mutate(matches, undefined, { revalidate: false }),
      keys: () => cache.keys(),
      get: key => cache.get(key),
      serializeInfinite,
      evictKey: key => mutate(key, undefined, { revalidate: false }),
      refresh: matches => mutate(matches),
    });
  }, { wrapper });
  await waitFor(() => expect(cache.get(unstable_serialize(keys[2]))?.data).toBe("feedback"));
  await waitFor(() => expect(room).toHaveBeenCalledOnce());
  const aggregateKey = serializeInfinite(() => ["post-replies", "41", 2]);
  await waitFor(() => expect(cache.get(aggregateKey)?.data).toEqual(["feedback", "feedback"]));
  room.mockRejectedValue(new Error("Offline refresh"));
  await act(async () => { await expect(result.current()).resolves.toBeUndefined(); });
  for (const key of keys.slice(0, 3)) expect(cache.get(unstable_serialize(key))?.data).toBeUndefined();
  expect(cache.get(unstable_serialize(keys[3]))?.data).toBe("other entry");
  expect(cache.get(aggregateKey)?.data).toBeUndefined();
  expect(room).toHaveBeenCalledTimes(2);
});
