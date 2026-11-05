import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({ round: vi.fn(), board: vi.fn(), room: vi.fn(), members: vi.fn() }));
vi.mock("../../../../frontend/src/lib/api", () => ({ client: {} }));
vi.mock("../../../../frontend/src/hooks/useRoomSubscription", () => ({ useRoomSubscription: vi.fn() }));
vi.mock("../../../../frontend/src/lib/api/board", () => ({ fetchBoard: mocks.board }));
vi.mock("../../../../frontend/src/lib/api/rooms", () => ({ fetchRoom: mocks.room, fetchRoomMembers: mocks.members }));
vi.mock("../../../../frontend/src/lib/api/rounds", async importOriginal => ({ ...await importOriginal<object>(), fetchRound: mocks.round }));
const expo = "../../../../frontend";
const { act, createElement: h } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { SWRConfig } = await import(`${expo}/node_modules/swr/dist/index/index.mjs`);
const { useRound } = await import(`${expo}/src/hooks/useRounds.ts`);
let root: Root | undefined;
let query: ReturnType<typeof useRound>;
async function mount() {
  function Probe() { query = useRound("3", "12"); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(h(SWRConfig, { value: { provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0 } }, h(Probe))));
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.resetAllMocks(); });
it("resolves Room-owned historical URLs without requesting a Board", async () => {
  mocks.round.mockResolvedValue({ round: { id: "12", roomId: "8" } });
  mocks.room.mockResolvedValue({ access: { can_manage: false } });
  await mount();
  expect(mocks.room).toHaveBeenCalledWith({}, "8");
  expect(mocks.board).not.toHaveBeenCalled();
  expect(query.canManage).toBe(false);
  expect(query.detail.data?.round.id).toBe("12");
});
it("revokes management and member discovery when the Room revalidation fails", async () => {
  mocks.round.mockResolvedValue({ round: { id: "12", roomId: "8" } });
  mocks.room.mockResolvedValue({ access: { can_manage: true } });
  mocks.members.mockResolvedValue([]);
  await mount();
  expect(query.canManage).toBe(true);
  mocks.room.mockRejectedValue(new Error("Access revoked"));
  await act(async () => { await query.room.mutate().catch(() => {}); });
  expect(query.canManage).toBe(false);
  expect(mocks.board).not.toHaveBeenCalled();
});
it("does not use a Board to recover a denied Round", async () => {
  mocks.round.mockRejectedValue(new Error("Denied"));
  await mount();
  expect(mocks.board).not.toHaveBeenCalled();
  expect(query.canManage).toBe(false);
});
