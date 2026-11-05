import { act, render } from "@testing-library/react";
import { vi } from "vitest";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "../../../../frontend/site/lib/swrQuery";

const useSWRMock = vi.fn();
const mutateMock = vi.fn();
const useSWRInfiniteMock = vi.fn();
const useSWRMutationMock = vi.fn();

vi.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => useSWRMock(...args),
  mutate: (...args: unknown[]) => mutateMock(...args),
  useSWRConfig: () => ({ cache: new Map(), mutate: mutateMock }),
  unstable_serialize: (key: unknown) => JSON.stringify(key),
}));

vi.mock("swr/infinite", () => ({
  __esModule: true,
  default: (...args: unknown[]) => useSWRInfiniteMock(...args),
  unstable_serialize: () => "infinite-key",
}));

vi.mock("swr/mutation", () => ({
  __esModule: true,
  default: (...args: unknown[]) => useSWRMutationMock(...args),
}));

function QueryHarness({ onReady }: { onReady: (value: ReturnType<typeof useQuery<string>>) => void }) {
  const value = useQuery({ queryKey: ["key"], queryFn: async () => "data" });
  onReady(value);
  return null;
}

function QueryOptionsHarness({ onReady }: { onReady: (value: ReturnType<typeof useQuery<string>>) => void }) {
  const value = useQuery({
    queryKey: ["key"],
    queryFn: async () => "data",
    staleTime: 1_000,
    refetchInterval: 2_000,
    refetchOnMount: "always",
  });
  onReady(value);
  return null;
}

function InfiniteHarness({ onReady }: { onReady: (value: ReturnType<typeof useInfiniteQuery<{ next: null }>>) => void }) {
  const value = useInfiniteQuery({
    queryKey: ["key"],
    queryFn: async () => ({ next: null }),
    getNextPageParam: (page) => (page as { next: number | null }).next,
  });
  onReady(value);
  return null;
}

function MutationHarness({ onReady }: { onReady: (value: ReturnType<typeof useMutation<number, unknown, number>>) => void }) {
  const value = useMutation({ mutationFn: async (input: number) => input + 1 });
  onReady(value);
  return null;
}

function QueryClientHarness({ onReady }: { onReady: (value: ReturnType<typeof useQueryClient>) => void }) {
  const value = useQueryClient();
  onReady(value);
  return null;
}

describe("swrQuery helpers", () => {
  beforeEach(() => {
    useSWRMock.mockReset();
    mutateMock.mockReset();
    useSWRInfiniteMock.mockReset();
    useSWRMutationMock.mockImplementation((key, fetcher) => ({
      trigger: (arg: unknown) => fetcher(key, { arg }),
      isMutating: false,
    }));
  });

  it("wraps useQuery with error/loading helpers", () => {
    const onReady = vi.fn();
    const swrMutate = vi.fn();
    useSWRMock.mockReturnValue({ data: "ok", error: null, isLoading: false, mutate: swrMutate });

    render(<QueryHarness onReady={onReady} />);

    const value = onReady.mock.calls[0][0] as ReturnType<typeof useQuery<string>>;
    expect(value.data).toBe("ok");
    expect(value.isError).toBe(false);
    value.refetch();
    expect(swrMutate).toHaveBeenCalled();
  });

  it("forwards stale/refetch options to useQuery config", () => {
    useSWRMock.mockReturnValue({ data: "ok", error: null, isLoading: false, isValidating: false, mutate: vi.fn() });

    render(<QueryOptionsHarness onReady={vi.fn()} />);

    const config = useSWRMock.mock.calls.at(-1)?.[2] as
      | {
          dedupingInterval?: number;
          refreshInterval?: number;
          revalidateOnMount?: boolean;
          revalidateOnFocus?: boolean;
          revalidateOnReconnect?: boolean;
          revalidateIfStale?: boolean;
          keepPreviousData?: boolean;
        }
      | undefined;
    expect(config?.dedupingInterval).toBe(1_000);
    expect(config?.refreshInterval).toBe(2_000);
    expect(config?.revalidateOnMount).toBe(true);
    expect(config?.revalidateOnFocus).toBe(false);
    expect(config?.revalidateOnReconnect).toBe(false);
    expect(config?.revalidateIfStale).toBe(false);
    expect(config?.keepPreviousData).toBe(true);
  });

  it("wraps useInfiniteQuery paging helpers", () => {
    const onReady = vi.fn();
    const setSize = vi.fn();
    useSWRInfiniteMock.mockReturnValue({
      data: [{ next: null }],
      error: null,
      isLoading: false,
      isValidating: false,
      size: 1,
      setSize,
    });

    render(<InfiniteHarness onReady={onReady} />);

    const value = onReady.mock.calls[0][0] as ReturnType<typeof useInfiniteQuery<{ next: null }>>;
    expect(value.hasNextPage).toBe(false);
    value.fetchNextPage();
    expect(setSize).toHaveBeenCalled();
    const config = useSWRInfiniteMock.mock.calls[0][2] as { dedupingInterval?: number };
    expect(config?.dedupingInterval).toBeUndefined();
  });

  it("forwards staleTime to useInfiniteQuery config", () => {
    const onReady = vi.fn();
    useSWRInfiniteMock.mockReturnValue({
      data: [{ next: null }],
      error: null,
      isLoading: false,
      isValidating: false,
      size: 1,
      setSize: vi.fn(),
      mutate: vi.fn(),
    });

    function InfiniteStaleHarness({ onReady }: { onReady: (value: ReturnType<typeof useInfiniteQuery<{ next: null }>>) => void }) {
      const value = useInfiniteQuery({
        queryKey: ["key"],
        queryFn: async () => ({ next: null }),
        getNextPageParam: (page) => (page as { next: number | null }).next,
        staleTime: 5_000,
      });
      onReady(value);
      return null;
    }

    render(<InfiniteStaleHarness onReady={onReady} />);
    const config = useSWRInfiniteMock.mock.calls[0][2] as { dedupingInterval?: number };
    expect(config?.dedupingInterval).toBe(5_000);
  });

  it("handles mutation lifecycle", async () => {
    const onReady = vi.fn();
    render(<MutationHarness onReady={onReady} />);

    const value = onReady.mock.calls[0][0] as ReturnType<typeof useMutation<number, unknown, number>>;

    await act(async () => {
      const result = await value.mutateAsync(1);
      expect(result).toBe(2);
    });

    await act(async () => {
      value.mutate(2);
    });
  });

  it("exposes query client helpers", () => {
    const onReady = vi.fn();
    render(<QueryClientHarness onReady={onReady} />);

    const value = onReady.mock.calls[0][0] as ReturnType<typeof useQueryClient>;

    value.setQueryData(["key"], () => "next");
    value.setQueriesData({ queryKey: ["key"] }, () => "next");
    value.getQueryData(["key"]);
    value.invalidateQueries({ queryKey: ["key"] });
    value.removeQueries({ queryKey: ["key"] });
    value.refetchQueries({ queryKey: ["key"] });

    expect(mutateMock).toHaveBeenCalled();
    expect(mutateMock.mock.calls[1]).toHaveLength(3);
    expect(typeof mutateMock.mock.calls[1][0]).toBe("function");
    expect(mutateMock.mock.calls[2]).toHaveLength(1);
    expect(typeof mutateMock.mock.calls[2][0]).toBe("function");
    expect(mutateMock.mock.calls[4]).toHaveLength(1);
    expect(typeof mutateMock.mock.calls[4][0]).toBe("function");
  });
});
