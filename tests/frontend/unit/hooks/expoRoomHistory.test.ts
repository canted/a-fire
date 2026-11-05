import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../../../frontend/src/lib/api", () => ({ client: { get: mocks.get } }));
const expo = "../../../../frontend";
const { act, createElement: h } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { SWRConfig } = await import(`${expo}/node_modules/swr/dist/index/index.mjs`);
const { useRoomHistory } = await import(`${expo}/src/hooks/useRoomHistory.ts`);
let root: Root | undefined;
let state: ReturnType<typeof import("../../../../frontend/src/hooks/useRoomHistory").useRoomHistory>;
let access: "member" | "visitor" | undefined = "member";
function Probe() { state = useRoomHistory("7", access); return null; }
const cache = () => new Map();
async function render() {
  root ??= createRoot(document.createElement("div"));
  await act(async () => root!.render(h(SWRConfig, { value: { provider: cache, dedupingInterval: 0, shouldRetryOnError: false } }, h(Probe))));
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; access = "member"; vi.resetAllMocks(); });
it("loads cursor pages, deduplicates live overlaps, and hides cached history after access loss", async () => {
  const first = { id: "activity:1", label: "First completed", occurredAt: "2026-01-01T00:00:00.000000Z" };
  const second = { ...first, id: "member:2", label: "Member joined" };
  mocks.get.mockImplementation(async (path: string) => path.includes("cursor=") ? { items: [first, second], nextCursor: null } : { items: [first], nextCursor: "next/cursor" });
  await render();
  expect(state.items.map(item => item.id)).toEqual(["activity:1"]);
  expect(state.hasMore).toBe(true);
  await act(async () => { await state.query.setSize(2); });
  expect(mocks.get).toHaveBeenCalledWith("/v1/rooms/7/history?cursor=next%2Fcursor");
  expect(state.items.map(item => item.id)).toEqual(["activity:1", "member:2"]);
  expect(state.hasMore).toBe(false);
  mocks.get.mockRejectedValue(new Error("Forbidden"));
  await act(async () => { await state.query.mutate().catch(() => {}); });
  expect(state.items).toEqual([]);
  expect(state.hasMore).toBe(false);
  expect(state.query.error).toBeTruthy();
  access = undefined;
  const reads = mocks.get.mock.calls.length;
  await render();
  expect(state.items).toEqual([]);
  expect(mocks.get.mock.calls).toHaveLength(reads);
});
