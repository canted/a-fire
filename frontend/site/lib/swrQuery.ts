import useSWR, { useSWRConfig, unstable_serialize, type Key } from "swr";
import useSWRMutation from "swr/mutation";
import useSWRInfinite, { unstable_serialize as serializeInfinite } from "swr/infinite";
import { useCallback, useEffect, useMemo, useId } from "react";

import { registrations, type InfiniteRegistration } from "../../src/lib/infiniteQueryRegistry";

function matchesQueryKey(candidate: Key, target: Key): boolean {
  const candidateParts = Array.isArray(candidate) ? candidate : [candidate];
  const targetParts = Array.isArray(target) ? target : [target];
  return targetParts.length <= candidateParts.length && targetParts.every((value, index) =>
    unstable_serialize([value]) === unstable_serialize([candidateParts[index]]),
  );
}

type QueryFn<T> = () => Promise<T>;

type UseQueryOptions<TData, TError = unknown> = {
  queryKey: Key;
  queryFn: QueryFn<TData>;
  enabled?: boolean;
  staleTime?: number;
  refetchInterval?: number | ((data: TData | undefined) => number);
  refetchOnMount?: boolean | "always";
  revalidateOnFocus?: boolean;
  revalidateOnReconnect?: boolean;
  revalidateIfStale?: boolean;
  keepPreviousData?: boolean;
  onSuccess?: (data: TData) => void;
  onError?: (error: TError) => void;
};

export function useQuery<TData, TError = unknown>({
  queryKey,
  queryFn,
  enabled = true,
  staleTime,
  refetchInterval,
  refetchOnMount,
  revalidateOnFocus = false,
  revalidateOnReconnect = false,
  revalidateIfStale = false,
  keepPreviousData = true,
  onSuccess,
  onError,
}: UseQueryOptions<TData, TError>) {
  const config: Parameters<typeof useSWR<TData, TError>>[2] = {
    revalidateOnFocus,
    revalidateOnReconnect,
    revalidateIfStale,
    dedupingInterval: staleTime,
    refreshInterval: refetchInterval,
    revalidateOnMount: refetchOnMount === "always" ? true : refetchOnMount,
    keepPreviousData,
  };
  if (onSuccess) {
    config.onSuccess = onSuccess;
  }
  if (onError) {
    config.onError = onError;
  }
  const swr = useSWR<TData, TError>(enabled ? queryKey : null, queryFn, config);

  const refetch = useCallback(() => swr.mutate(), [swr]);

  return {
    ...swr,
    isLoading: swr.isLoading,
    isFetching: swr.isValidating,
    isError: Boolean(swr.error),
    refetch,
  };
}

type UseInfiniteQueryOptions<TPage> = {
  queryKey: Key;
  queryFn: ({ pageParam }: { pageParam?: unknown }) => Promise<TPage>;
  getNextPageParam: (lastPage: TPage) => number | string | null | undefined;
  enabled?: boolean;
  initialPageParam?: number | string;
  staleTime?: number;
  refetchInterval?: number | ((data: TPage[] | undefined) => number);
  refetchOnMount?: boolean | "always";
  revalidateOnFocus?: boolean;
  revalidateOnReconnect?: boolean;
  revalidateIfStale?: boolean;
  revalidateFirstPage?: boolean;
};

export function useInfiniteQuery<TPage>({
  queryKey,
  queryFn,
  getNextPageParam,
  enabled = true,
  initialPageParam = 1,
  staleTime,
  refetchInterval,
  refetchOnMount,
  revalidateOnFocus = false,
  revalidateOnReconnect = false,
  revalidateIfStale = false,
  revalidateFirstPage = false,
}: UseInfiniteQueryOptions<TPage>) {
  const getKey = (index: number, previousPageData: TPage | null) => {
    if (!enabled) return null;
    if (previousPageData && getNextPageParam(previousPageData) == null) return null;
    const pageParam = index === 0 ? initialPageParam : getNextPageParam(previousPageData as TPage);
    return [queryKey, pageParam];
  };

  const swr = useSWRInfinite<TPage>(
    getKey,
    async ([, pageParam]) => queryFn({ pageParam }),
    {
      revalidateFirstPage,
      dedupingInterval: staleTime,
      refreshInterval: refetchInterval,
      revalidateOnMount: refetchOnMount === "always" ? true : refetchOnMount,
      revalidateOnFocus,
      revalidateOnReconnect,
      revalidateIfStale,
    },
  );

  const { cache, mutate } = useSWRConfig();
  useEffect(() => {
    if (!enabled) return;
    const entry: InfiniteRegistration = {
      queryKey,
      cacheKey: serializeInfinite(getKey),
      revalidate: () => swr.mutate(),
      update: (updater) => {
        let update = updater;
        if (typeof update === "function" && cache.get(entry.cacheKey)?.data === undefined) {
          update = update(undefined);
          // A realtime patch has nothing to change before the first page arrives.
          // Starting a mutation here would discard that in-flight fetch response.
          if (update === undefined) return Promise.resolve(undefined);
        }
        return swr.mutate((previous) => {
          const next = typeof update === "function" ? update(previous ? { pages: previous } : undefined) : update;
          // Keep page caches consistent when pagination reads them again.
          let previousPage: TPage | null = null;
          (next?.pages ?? previous ?? []).forEach((page: TPage, index: number) => {
            const key = getKey(index, previousPage);
            if (key) void mutate(key, next ? page : undefined, false);
            previousPage = page;
          });
          return next?.pages;
        }, false);
      },
    };
    const entries = registrations(cache);
    entries.add(entry);
    return () => { entries.delete(entry); };
  });

  const pages = swr.data ?? [];
  const hasNextPage = pages.length > 0 ? getNextPageParam(pages[pages.length - 1]) != null : false;
  const fetchNextPage = () => swr.setSize((size) => size + 1);
  const refetch = () => swr.mutate();

  return {
    ...swr,
    data: { pages },
    isLoading: swr.isLoading,
    isFetching: swr.isValidating,
    isError: Boolean(swr.error),
    hasNextPage,
    fetchNextPage,
    refetch,
    isFetchingNextPage: swr.isValidating && swr.size > (swr.data?.length ?? 0),
  };
}

type UseMutationOptions<TData, TError = unknown, TVariables = void> = {
  mutationFn: (variables: TVariables) => Promise<TData>;
  onSuccess?: (data: TData, variables: TVariables) => unknown;
  onError?: (error: TError, variables: TVariables) => unknown;
  onSettled?: (data: TData | undefined, error: TError | null, variables: TVariables) => unknown;
};

type MutationArgs<TVariables> = TVariables extends void ? [] | [TVariables] : [TVariables];

export function useMutation<TData, TError = unknown, TVariables = void>({
  mutationFn,
  onSuccess,
  onError,
  onSettled,
}: UseMutationOptions<TData, TError, TVariables>) {
  const mutationId = useId();
  // Each caller gets independent state; SWR owns pending/error handling and races.
  const mutation = useSWRMutation<TData, TError, readonly [string, string], { variables: TVariables }>(
    ["mutation", mutationId],
    async (_key, { arg: { variables } }) => {
      try {
        const result = await mutationFn(variables);
        await onSuccess?.(result, variables);
        await onSettled?.(result, null, variables);
        return result;
      } catch (error) {
        const typedError = error as TError;
        await onError?.(typedError, variables);
        await onSettled?.(undefined, typedError, variables);
        throw typedError;
      }
    },
    { revalidate: false, populateCache: false },
  );
  const { trigger } = mutation;
  const mutateAsync = useCallback(
    (...args: MutationArgs<TVariables>) => trigger({ variables: args[0] as TVariables }),
    [trigger],
  );
  const mutate = useCallback(
    (...args: MutationArgs<TVariables>) => {
      // The error is exposed through SWR; fire-and-forget callers must not leak a rejection.
      void mutateAsync(...args).catch(() => undefined);
    },
    [mutateAsync],
  );
  return { mutateAsync, mutate, isPending: mutation.isMutating, error: mutation.error ?? null };
}

export function useQueryClient() {
  const { cache, mutate } = useSWRConfig();
  const matchingInfinite = useCallback((queryKey: Key, exact = false) => {
    const byCacheKey = new Map<string, InfiniteRegistration>();
    for (const entry of registrations(cache)) {
      if (exact ? unstable_serialize(entry.queryKey) === unstable_serialize(queryKey) : matchesQueryKey(entry.queryKey, queryKey)) {
        byCacheKey.set(entry.cacheKey, entry);
      }
    }
    return [...byCacheKey.values()];
  }, [cache]);

  const setQueryData = useCallback(<T,>(key: Key, updater: T | ((prev: T | undefined) => T | undefined)) => {
    const entries = matchingInfinite(key, true);
    if (entries.length) return Promise.all(entries.map((entry) => entry.update(updater)));
    const cacheKey = unstable_serialize(key);
    if (cacheKey) {
      // SWR registers this logical key when a query mounts. Imperative priming
      // needs the same metadata so prefix invalidation also finds unmounted data.
      const keyedState = { ...cache.get(cacheKey), _k: key };
      cache.set(cacheKey, keyedState);
    }
    return mutate(key, updater as any, false);
  }, [cache, matchingInfinite, mutate]);

  const setQueriesData = useCallback(<T,>({ queryKey }: { queryKey: Key }, updater: T | ((prev: T | undefined) => T | undefined)) =>
    Promise.all([
      mutate((candidate) => matchesQueryKey(candidate, queryKey), updater as any, false),
      ...matchingInfinite(queryKey).map((entry) => entry.update(updater)),
    ]), [matchingInfinite, mutate]);

  const getQueryData = useCallback(<T,>(key: Key): T | undefined => {
    const entry = matchingInfinite(key, true)[0];
    const data = cache.get(entry?.cacheKey ?? unstable_serialize(key))?.data;
    return entry && data ? { pages: data } as T : data;
  }, [cache, matchingInfinite]);

  const invalidateQueries = useCallback(({ queryKey }: { queryKey: Key }) => Promise.all([
    mutate((candidate) => matchesQueryKey(candidate, queryKey)),
    ...matchingInfinite(queryKey).map((entry) => entry.revalidate()),
  ]), [matchingInfinite, mutate]);

  const removeQueries = useCallback(({ queryKey }: { queryKey: Key }) => Promise.all([
    mutate((candidate) => matchesQueryKey(candidate, queryKey), undefined, false),
    ...matchingInfinite(queryKey).map((entry) => entry.update(undefined)),
  ]), [matchingInfinite, mutate]);

  return useMemo(() => ({ setQueryData, setQueriesData, getQueryData, invalidateQueries, removeQueries, refetchQueries: invalidateQueries }),
    [setQueryData, setQueriesData, getQueryData, invalidateQueries, removeQueries]);
}

export { useSWR, useSWRMutation, useSWRInfinite };
