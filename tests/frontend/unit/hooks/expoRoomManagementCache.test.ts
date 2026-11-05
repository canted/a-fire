import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ mutate: vi.fn(), patch: vi.fn(), fetcher: undefined as undefined | ((key: unknown, input: { arg: unknown }) => Promise<unknown>) }));
vi.mock("../../../../frontend/node_modules/react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("../../../../frontend/node_modules/react", () => ({ useRef: () => ({ current: null }) }));
vi.mock("../../../../frontend/node_modules/swr", () => ({
  default: (key: unknown) => ({ data: Array.isArray(key) && key[0] === "managed-room" ? { owner_id: 1, access: { can_manage: true } } : key === "memberships" ? { user: { id: 1 } } : undefined }),
  useSWRConfig: () => ({ mutate: state.mutate }),
}));
vi.mock("../../../../frontend/node_modules/swr/dist/mutation/index.mjs", () => ({ default: (_key: unknown, fetcher: typeof state.fetcher) => { state.fetcher = fetcher; return { trigger: vi.fn() }; } }));
vi.mock("../../../../frontend/src/lib/api", () => ({ client: { patch: state.patch } }));
vi.mock("../../../../frontend/src/lib/chatFiles", () => ({ appendPickedFile: vi.fn() }));
vi.mock("../../../../frontend/src/lib/imageFile", () => ({ assertImageFile: vi.fn() }));
import { useRoomManagement } from "../../../../frontend/src/hooks/useRoomManagement";
beforeEach(() => { vi.clearAllMocks(); state.mutate.mockResolvedValue(undefined); state.patch.mockResolvedValue({ replyMode: "simple" }); });
it("writes Room settings and refreshes retained Board adapters without confusing their IDs", async () => {
  useRoomManagement("7");
  await state.fetcher!(null, { arg: { kind: "reply", settings: { replyMode: "simple" } } });
  expect(state.patch).toHaveBeenCalledWith("/v1/rooms/7/feedback-settings", { replyMode: "simple" });
  const predicate = state.mutate.mock.calls[0][0];
  expect(predicate(["board", "91"])).toBe(true);
  expect(predicate(["board", "92"])).toBe(true);
  expect(predicate(["managed-room", "7"])).toBe(true);
  expect(predicate(["room-home", "7"])).toBe(true);
  expect(predicate(["room-home", "8"])).toBe(false);
  expect(predicate(["managed-room", "8"])).toBe(false);
  expect(predicate(["post", "91"])).toBe(false);
});
it("does not refresh caches when saving settings fails", async () => {
  useRoomManagement("7");
  state.patch.mockRejectedValueOnce(new Error("Save failed"));
  await expect(state.fetcher!(null, { arg: { kind: "reply", settings: { replyMode: "simple" } } })).rejects.toThrow("Save failed");
  expect(state.mutate).not.toHaveBeenCalled();
});
