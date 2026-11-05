import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({ copy: vi.fn(), publish: vi.fn(), refresh: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../../frontend/src/hooks/useProjectShare", () => ({ useProjectShare: () => ({ share: { trigger: mocks.copy } }) }));
vi.mock("../../../../frontend/src/hooks/useRoundContribution", () => ({ useRoundDraftCompletion: () => ({ trigger: mocks.publish }) }));
vi.mock("../../../../frontend/src/hooks/useEntryDraft", () => ({ useEntryDraft: ({ existing }: { existing?: string }) => ({ draft: { data: existing ? { id: Number(existing) } : undefined, mutate: mocks.refresh }, publish: {}, submit: mocks.publish }) }));
const expo = "../../../../frontend";
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { useRoomEntryPublication } = await import(`${expo}/src/hooks/useRoomEntryPublication.ts`);
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; vi.clearAllMocks(); });
it("copies the entire saved source and retries publication against the same copy", async () => {
  mocks.copy.mockResolvedValue({ entry_id: 71 });
  mocks.publish.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue({ id: 71 });
  let value: ReturnType<typeof useRoomEntryPublication>;
  function Probe() { value = useRoomEntryPublication("12", 41, "7"); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe)));
  let first!: Promise<unknown>;
  await act(async () => { first = value!.publish().catch((error: unknown) => error); });
  expect(await first).toEqual(new Error("Offline"));
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith({ room_id: 7 });
  expect(value!.prepared).toBe(true);
  let second!: Promise<unknown>;
  await act(async () => { second = value!.publish(); });
  expect(await second).toEqual({ entryId: 71, path: "/app/entries/71" });
  expect(mocks.copy).toHaveBeenCalledOnce();
  expect(mocks.publish).toHaveBeenCalledTimes(2);
  expect(value!.busy).toBe(false);
});
it("recovers the same keyed copy after remount without automatically publishing", async () => {
  mocks.copy.mockResolvedValue({ entry_id: 71 });
  mocks.publish.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue({ id: 71 });
  let value: ReturnType<typeof useRoomEntryPublication>;
  function Probe() { value = useRoomEntryPublication("12", 41, "7", "room-entry-12-41-7-room-entry"); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe)));
  let first!: Promise<unknown>;
  await act(async () => { first = value!.publish().catch((error: unknown) => error); });
  expect(await first).toEqual(new Error("Offline"));
  await act(async () => root!.unmount());
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe)));
  expect(mocks.publish).toHaveBeenCalledTimes(1);
  let resumed!: Promise<unknown>;
  await act(async () => { resumed = value!.publish(); });
  expect(await resumed).toEqual({ entryId: 71, path: "/app/entries/71" });
  expect(mocks.copy.mock.calls.map(([input]) => input)).toEqual([
    { room_id: 7, request_key: "room-entry-12-41-7-room-entry" },
    { room_id: 7, request_key: "room-entry-12-41-7-room-entry" },
  ]);
});
it("finishes an authorized recovered copy without creating or selecting source material again", async () => {
  mocks.publish.mockResolvedValue({ id: 81 });
  let value: ReturnType<typeof useRoomEntryPublication>;
  function Probe() { value = useRoomEntryPublication("12", 41, "7", undefined, { entry_id: 81, room_id: 7 }); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe)));
  expect(value!.prepared).toBe(true);
  expect(mocks.publish).not.toHaveBeenCalled();
  let result!: Promise<unknown>;
  await act(async () => { result = value!.publish(); });
  expect(await result).toEqual({ entryId: 81, path: "/app/entries/81" });
  expect(mocks.copy).not.toHaveBeenCalled();
  expect(mocks.publish).toHaveBeenCalledOnce();
});
