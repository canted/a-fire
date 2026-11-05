import { render } from "@testing-library/react";
import { vi } from "vitest";

const { useQueryMock, apiClientMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  apiClientMock: { get: vi.fn() },
}));

vi.mock("@/lib/swrQuery", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/hooks/useApiClient", () => ({
  useApiClient: () => apiClientMock,
}));

import { useClientBuildStatus } from "../../../../frontend/site/hooks/useClientBuildStatus";

let queryData: { buildId: string | null } | undefined;
const refetchMock = vi.fn();
type ClientBuildQueryOptions = {
  queryKey: unknown;
  refetchInterval?: number;
  revalidateOnFocus?: boolean;
  revalidateOnReconnect?: boolean;
  queryFn: () => Promise<unknown>;
};

function Harness({ onReady }: { onReady: (value: ReturnType<typeof useClientBuildStatus>) => void }) {
  const value = useClientBuildStatus();
  onReady(value);
  return null;
}

describe("useClientBuildStatus", () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta name="afire-build-id" content="current-build" />';
    queryData = undefined;
    refetchMock.mockReset();
    apiClientMock.get.mockReset();
    useQueryMock.mockImplementation((options: unknown) => {
      return { data: queryData, isFetching: false, refetch: refetchMock, options };
    });
  });

  it("uses the client-build query and no-store request", async () => {
    const onReady = vi.fn();
    render(<Harness onReady={onReady} />);

    const config = useQueryMock.mock.calls[0][0] as ClientBuildQueryOptions;

    expect(config.queryKey).toEqual(["client-build"]);
    expect(config.refetchInterval).toBe(30 * 1000);
    expect(config.revalidateOnFocus).toBe(true);
    expect(config.revalidateOnReconnect).toBe(true);

    await config.queryFn();

    expect(apiClientMock.get).toHaveBeenCalledWith("/client-build", { cache: "no-store" });
  });

  it("reports no update when current and latest build ids match", () => {
    queryData = { buildId: "current-build" };
    const onReady = vi.fn();

    render(<Harness onReady={onReady} />);

    const value = onReady.mock.calls.at(-1)?.[0] as ReturnType<typeof useClientBuildStatus>;
    expect(value.updateAvailable).toBe(false);
  });

  it("reports a mismatch after the first successful response", () => {
    const onReady = vi.fn();
    queryData = { buildId: "next-build" };
    render(<Harness onReady={onReady} />);

    const value = onReady.mock.calls.at(-1)?.[0] as ReturnType<typeof useClientBuildStatus>;
    expect(value.updateAvailable).toBe(true);
  });

  it("does nothing when current build metadata is missing", () => {
    document.head.innerHTML = "";
    queryData = { buildId: "next-build" };
    const onReady = vi.fn();

    render(<Harness onReady={onReady} />);

    const value = onReady.mock.calls.at(-1)?.[0] as ReturnType<typeof useClientBuildStatus>;
    expect(value.currentBuildId).toBeNull();
    expect(value.updateAvailable).toBe(false);
  });

  it("refetches when the document becomes visible", () => {
    render(<Harness onReady={vi.fn()} />);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });

    document.dispatchEvent(new Event("visibilitychange"));

    expect(refetchMock).toHaveBeenCalled();
  });
});
