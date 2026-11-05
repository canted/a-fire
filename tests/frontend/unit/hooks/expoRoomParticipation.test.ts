import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({ get: vi.fn(), session: { ready: true, signedIn: true, epoch: 1 } }));
vi.mock("../../../../frontend/src/lib/api", () => ({ client: { get: mocks.get } }));
vi.mock("../../../../frontend/src/hooks/useSession", () => ({ useSession: () => mocks.session }));
const expo = "../../../../frontend";
const { act, createElement: h } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { SWRConfig } = await import(`${expo}/node_modules/swr/dist/index/index.mjs`);
const { useRoomParticipation } = await import(`${expo}/src/hooks/useRoomParticipation.ts`);
let root: Root | undefined;
let state: ReturnType<typeof import("../../../../frontend/src/hooks/useRoomParticipation").useRoomParticipation>;
function Probe() { state = useRoomParticipation("7", true); return null; }
const cache = () => new Map();
async function render() {
  root ??= createRoot(document.createElement("div"));
  await act(async () => root!.render(h(SWRConfig, { value: { provider: cache, dedupingInterval: 0, shouldRetryOnError: false } }, h(Probe))));
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.resetAllMocks(); Object.assign(mocks.session, { ready: true, signedIn: true, epoch: 1 }); });
it("loads personal pages and prevents previous-session or denied data from being displayed", async () => {
  const item = (id: string) => ({ id, round: { id: "4", boardId: null, name: "Round" }, contribution: { entryId: id, kind: "submission" } });
  mocks.get.mockImplementation(async (path: string) => path.includes("cursor=") ? { items: [item("1"), item("2")], nextCursor: null } : { items: [item("1")], nextCursor: "older/cursor" });
  await render();
  expect(state.items.map(item => item.id)).toEqual(["1"]);
  await act(async () => { await state.query.setSize(2); });
  expect(mocks.get).toHaveBeenCalledWith("/v1/rooms/7/participation?cursor=older%2Fcursor");
  expect(state.items.map(item => item.id)).toEqual(["1", "2"]);
  expect(state.hasMore).toBe(false);
  mocks.session.epoch = 2;
  mocks.get.mockResolvedValue({ items: [item("new-account")], nextCursor: null });
  await render();
  expect(state.items.map(item => item.id)).toEqual(["new-account"]);
  mocks.get.mockRejectedValue(new Error("Forbidden"));
  await act(async () => { await state.query.mutate().catch(() => {}); });
  expect(state.items).toEqual([]);
  mocks.session.signedIn = false;
  const reads = mocks.get.mock.calls.length;
  await render();
  expect(state.items).toEqual([]);
  expect(mocks.get.mock.calls).toHaveLength(reads);
});
