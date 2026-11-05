import { render } from "@testing-library/react";
import { vi } from "vitest";

const { ctor, sharedApiClient } = vi.hoisted(() => ({
  ctor: vi.fn(),
  sharedApiClient: { shared: true },
}));

vi.mock("@/lib/api/client", () => ({
  __esModule: true,
  ApiClient: class ApiClient {
    baseUrl: string;
    constructor(baseUrl: string) {
      this.baseUrl = baseUrl;
      ctor(baseUrl);
    }
  },
  apiClient: sharedApiClient,
}));

import { useApiClient } from "../../../../frontend/site/hooks/useApiClient";

function Harness({ baseUrl, onReady }: { baseUrl?: string; onReady: (client: unknown) => void }) {
  const client = useApiClient(baseUrl);
  onReady(client);
  return null;
}

describe("useApiClient", () => {
  beforeEach(() => {
    ctor.mockClear();
  });

  it("returns the shared client when no baseUrl is provided", () => {
    const onReady = vi.fn();
    render(<Harness onReady={onReady} />);

    const client = onReady.mock.calls[0][0];
    expect(client).toBe(sharedApiClient);
    expect(ctor).not.toHaveBeenCalled();
  });

  it("creates a new client when baseUrl is provided", () => {
    const onReady = vi.fn();
    render(<Harness baseUrl="/alt" onReady={onReady} />);

    const client = onReady.mock.calls[0][0] as { baseUrl?: string };
    expect(client).not.toBe(sharedApiClient);
    expect(client.baseUrl).toBe("/alt");
    expect(ctor).toHaveBeenCalledWith("/alt");
  });
});
