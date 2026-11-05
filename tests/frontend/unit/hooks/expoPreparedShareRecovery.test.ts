import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../../../frontend/src/lib/api", () => ({ client: { get: mocks.get } }));
vi.mock("../../../../frontend/src/hooks/useRounds", () => ({ useRoomRounds: () => ({}) }));
const expo = "../../../../frontend";
const { act, createElement: h, useState } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { SWRConfig } = await import(`${expo}/node_modules/swr/dist/index/index.mjs`);
const { usePreparedEntryShare } = await import(`${expo}/src/hooks/useProjectShare.ts`);
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.resetAllMocks(); });

it("keeps reviewed choices mounted while rechecking an empty no-copy response", async () => {
  mocks.get.mockResolvedValue(undefined);
  let query!: ReturnType<typeof usePreparedEntryShare>;
  let exclude!: () => void;
  function Choices() {
    const [included, setIncluded] = useState(true);
    exclude = () => setIncluded(false);
    return h("span", null, included ? "title included" : "title excluded");
  }
  function Screen() {
    query = usePreparedEntryShare("12", "41", "request-1");
    return query.isLoading ? "loading" : h(Choices);
  }
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root!.render(h(SWRConfig, { value: { provider: () => new Map(), shouldRetryOnError: false } }, h(Screen))));
  expect(query.data).toBeNull();
  await act(async () => exclude());
  let finish!: (value: undefined) => void;
  mocks.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let retry!: Promise<unknown>;
  await act(async () => { retry = query.mutate(); });
  expect(query.isLoading).toBe(false);
  expect(container.textContent).toBe("title excluded");
  await act(async () => { finish(undefined); await retry; });
  expect(container.textContent).toBe("title excluded");
  expect(query.data).toBeNull();
  expect(mocks.get).toHaveBeenCalledTimes(2);
});
