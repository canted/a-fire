import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
import type { RoundDetail } from "../../../../frontend/src/lib/api/rounds";
import type { ProjectEntry } from "../../../../frontend/src/lib/api/projectEntries";
const mocks = vi.hoisted(() => ({ share: vi.fn() }));
vi.mock("../../../../frontend/src/lib/api", () => ({ client: {} }));
vi.mock("../../../../frontend/src/hooks/useProjects", () => ({ useProjects: () => ({}), useProject: () => ({}) }));
vi.mock("../../../../frontend/src/lib/api/projectEntries", () => ({ shareProjectEntry: mocks.share }));
const expo = "../../../../frontend";
const { act, createElement: h } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { SWRConfig } = await import(`${expo}/node_modules/swr/dist/index/index.mjs`);
const { useRoundProjectEntries } = await import(`${expo}/src/hooks/useRoundContribution.ts`);
let root: Root | undefined;
let query: ReturnType<typeof useRoundProjectEntries>;
const detail = { round: { id: 322, roomId: 7 } } as unknown as RoundDetail;
const entry = { id: 41, intent: "Private title", question: "Private body", lyrics: "Private lyrics" } as ProjectEntry;
async function mount(kind: "cover" | "response" | "submission") {
  function Probe() { query = useRoundProjectEntries(12, detail, kind); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(h(SWRConfig, { value: { provider: () => new Map() } }, h(Probe))));
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.clearAllMocks(); });
it.each(["cover", "response", "submission"] as const)("uses the current full-copy contract for %s and recovers the same request after remount", async kind => {
  mocks.share.mockRejectedValueOnce(new Error("Response lost")).mockResolvedValue({ entry_id: 71 });
  await mount(kind);
  await act(async () => { await expect(query.share.trigger(entry)).rejects.toThrow("Response lost"); });
  await act(async () => root!.unmount());
  await mount(kind);
  await act(async () => { expect(await query.share.trigger(entry)).toEqual({ entry_id: 71 }); });
  const expected = { room_id: 7, round_id: 322, request_key: `round-project-322-${kind}-12-41`,
    ...(kind === "cover" ? { creation_origin: "round_activity_cover" } : kind === "response" ? { creation_origin: "round_activity_response" } : {}) };
  expect(mocks.share.mock.calls).toEqual([[{}, 12, 41, expected], [{}, 12, 41, expected]]);
});
