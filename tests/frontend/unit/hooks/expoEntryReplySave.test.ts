import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({ keep: vi.fn(), get: vi.fn(), memberships: vi.fn() }));
vi.mock("../../../../frontend/src/lib/api", () => ({ client: { post: mocks.keep, get: mocks.get } }));
vi.mock("../../../../frontend/src/lib/api/profile", () => ({ fetchMemberships: mocks.memberships }));
vi.mock("../../../../frontend/src/lib/api/projectEntries", () => ({ keepProjectFeedback: mocks.keep }));
const expo = "../../../../frontend";
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { SWRConfig } = await import(`${expo}/node_modules/swr/dist/index/index.mjs`);
const { useEntryReplySave } = await import(`${expo}/src/hooks/useEntryReplySave.ts`);
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; vi.resetAllMocks(); });
async function mount(post: unknown, viewer = 7, groups: Array<{ reply_ids: number[] }> = []) {
  mocks.get.mockResolvedValue({ groups });
  mocks.memberships.mockResolvedValue({ user: { id: viewer }, memberships: [] });
  let result: ReturnType<typeof useEntryReplySave>;
  function Probe() { result = useEntryReplySave(post); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, createElement(Probe))));
  return () => result!;
}
const post = { id: 41, user: { id: 7 }, can_keep_replies: true, keep_project_id: 12, source_entry_id: 18 };
it("saves once to the known source project, retries failures, and confirms success", async () => {
  let reject!: (error: Error) => void;
  mocks.keep.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue({ groups: [{ reply_ids: [61, 62] }] });
  const result = await mount(post);
  expect(result().available).toBe(true);
  let first!: Promise<void>, duplicate!: Promise<void>;
  await act(async () => { first = result().toggle([61, 62]); duplicate = result().toggle([61, 62]); });
  expect(first).toBe(duplicate);
  expect(result().busy).toBe(true);
  expect(result().feedback).toBeUndefined();
  expect(mocks.keep).toHaveBeenCalledExactlyOnceWith("/v1/projects/12/reply-keeps/41", { reply_ids: [61, 62], saved: true });
  await act(async () => { reject(new Error("Offline. Try Save again.")); await first; });
  expect(result().feedback).toBe("Offline. Try Save again.");
  expect(result().busy).toBe(false);
  await act(async () => { await result().toggle([61, 62]); });
  expect(mocks.keep).toHaveBeenCalledTimes(2);
  expect(result().feedback).toBe("Replies saved to your source and shown in this room.");
});
it.each([
  [{ ...post, keep_project_id: undefined, source_entry_id: undefined }, 7],
  [post, 9],
])("never guesses a destination or grants another viewer the author's action", async (entry, viewer) => {
  const result = await mount(entry, viewer);
  expect(result().available).toBe(false);
  await act(async () => { await result().toggle([61, 62]); });
  expect(mocks.keep).not.toHaveBeenCalled();
});

it("loads persisted card state and toggles it off", async () => {
  const result = await mount(post);
  mocks.keep.mockResolvedValueOnce({ groups: [{ reply_ids: [61, 62] }] }).mockResolvedValueOnce({ groups: [] });
  await act(async () => { await result().toggle([61, 62]); });
  expect(result().isSaved([61, 62])).toBe(true);
  await act(async () => { await result().toggle([61, 62]); });
  expect(mocks.keep).toHaveBeenLastCalledWith("/v1/projects/12/reply-keeps/41", { reply_ids: [61, 62], saved: false });
  expect(result().isSaved([61, 62])).toBe(false);
});

it("shows a filled star from the persisted server state on a fresh visit", async () => {
  const result = await mount(post, 7, [{ reply_ids: [61, 62] }]);
  expect(result().isSaved([61, 62])).toBe(true);
  expect(result().isSaved([61, 62, 63])).toBe(false);
  expect(mocks.keep).not.toHaveBeenCalled();
});
