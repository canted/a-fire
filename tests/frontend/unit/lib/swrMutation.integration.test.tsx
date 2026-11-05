import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { SWRConfig } from "swr";
import { describe, expect, it, vi } from "vitest";
import { useMutation, useQueryClient } from "../../../../frontend/site/lib/swrQuery";

function provider() {
  const cache = new Map();
  return ({ children }: PropsWithChildren) => (
    <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("SWR mutation lifecycle", () => {
  it("keeps a mutation pending until asynchronous success work finishes", async () => {
    const saved = deferred<void>();
    const settled = vi.fn();
    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: async (input: number) => input + 1,
          onSuccess: () => saved.promise,
          onSettled: settled,
        }),
      { wrapper: provider() },
    );
    let request!: Promise<number>;
    act(() => {
      request = result.current.mutateAsync(1);
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(settled).not.toHaveBeenCalled();
    await act(async () => {
      saved.resolve();
      expect(await request).toBe(2);
    });
    expect(settled).toHaveBeenCalledWith(2, null, 1);
    expect(result.current.isPending).toBe(false);
  });

  it("exposes fire-and-forget failures and allows retry", async () => {
    const error = new Error("Offline");
    const request = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("saved");
    const onError = vi.fn();
    const settled = vi.fn();
    const { result } = renderHook(() => useMutation({ mutationFn: request, onError, onSettled: settled }), {
      wrapper: provider(),
    });
    act(() => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.error).toBe(error));
    expect(onError).toHaveBeenCalledWith(error, undefined);
    expect(settled).toHaveBeenCalledWith(undefined, error, undefined);
    await act(async () => {
      expect(await result.current.mutateAsync()).toBe("saved");
    });
    expect(result.current.error).toBeNull();
  });

  it("keeps separate callers' pending and error state independent", async () => {
    const pending = deferred<string>();
    const { result } = renderHook(
      () => ({
        first: useMutation({ mutationFn: () => pending.promise }),
        second: useMutation({ mutationFn: async () => "second" }),
      }),
      { wrapper: provider() },
    );
    let first!: Promise<string>;
    act(() => {
      first = result.current.first.mutateAsync();
    });
    await act(async () => {
      await result.current.second.mutateAsync();
    });
    expect(result.current.first.isPending).toBe(true);
    expect(result.current.second.isPending).toBe(false);
    await act(async () => {
      pending.resolve("first");
      await first;
    });
  });
  it("removes imperatively primed caches by prefix before a query mounts", async () => {
    const { result } = renderHook(() => useQueryClient(), { wrapper: provider() });
    await act(async () => {
      await result.current.setQueryData(["draft-reply", "1"], { id: 2 });
      await result.current.setQueryData(["post", "1"], { id: 1 });
      await result.current.removeQueries({ queryKey: ["draft-reply"] });
    });
    expect(result.current.getQueryData(["draft-reply", "1"])).toBeUndefined();
    expect(result.current.getQueryData(["post", "1"])).toEqual({ id: 1 });
  });
});
