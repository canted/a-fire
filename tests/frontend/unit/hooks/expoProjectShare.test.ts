import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({ share: vi.fn(), manifest: vi.fn().mockResolvedValue({ revision: "v1", units: [] }) }));
vi.mock("../../../../frontend/src/lib/api", () => ({ client: {} }));
vi.mock("../../../../frontend/src/lib/api/profile", () => ({ fetchMemberships: async () => ({ memberships: [] }) }));
vi.mock("../../../../frontend/src/hooks/useRounds", () => ({ useRoomRounds: () => ({ room: {}, rounds: {} }) }));
vi.mock("../../../../frontend/src/lib/api/projectEntries", () => ({ shareProjectEntry: mocks.share, fetchEntryShareManifest: mocks.manifest }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const expo = "../../../../frontend";
const { act, createElement: h } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { SWRConfig } = await import(`${expo}/node_modules/swr/dist/index/index.mjs`);
const { useProjectShare } = await import(`${expo}/src/hooks/useProjectShare.ts`);
let root: Root | undefined;
let query: ReturnType<typeof useProjectShare>;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.clearAllMocks(); });
async function mount(selection = false) {
  function Probe() { query = useProjectShare("12", 41, "7", selection); void query.manifest.data; return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(h(SWRConfig, { value: { provider: () => new Map(), shouldRetryOnError: false } }, h(Probe))));
}
it("deduplicates overlapping requests and retains the visit key after an uncertain response", async () => {
  let reject!: (error: Error) => void;
  mocks.share.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValue({ entry_id: 71 });
  await mount();
  let first!: Promise<unknown>, duplicate!: Promise<unknown>;
  await act(async () => {
    first = query.share.trigger({ room_id: 7 }).catch((error: unknown) => error);
    duplicate = query.share.trigger({ room_id: 7 }).catch((error: unknown) => error);
  });
  expect(mocks.share).toHaveBeenCalledOnce();
  const key = mocks.share.mock.calls[0][3].request_key;
  expect(key).toEqual(expect.any(String));
  await act(async () => { reject(new Error("Connection lost")); await Promise.all([first, duplicate]); });
  await act(async () => { await query.share.trigger({ room_id: 7 }); });
  expect(mocks.share).toHaveBeenCalledTimes(2);
  expect(mocks.share.mock.calls[1][3].request_key).toBe(key);
  expect(mocks.manifest).not.toHaveBeenCalled();
});
it("loads the selection manifest only for the explicit preview flow", async () => {
  await mount(true);
  expect(mocks.manifest).toHaveBeenCalledExactlyOnceWith({}, "12", 41, "7");
  expect(query.manifest.data?.revision).toBe("v1");
});
