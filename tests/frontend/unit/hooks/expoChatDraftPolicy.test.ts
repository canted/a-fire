import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
import { emptyRoomDraft, type RoomDraft } from "../../../../frontend/src/lib/chatComposition";
import { normalizeChatDraft } from "../../../../frontend/src/lib/chatDraftPolicy";
const state = vi.hoisted(() => ({ value: {} as RoomDraft, release: vi.fn() }));
vi.mock("../../../../frontend/src/hooks/useRooms", () => ({ useRoomDraft: () => ({ ...state.value, read: () => state.value, update: (patch: Partial<RoomDraft>) => { state.value = { ...state.value, ...patch }; } }) }));
vi.mock("../../../../frontend/src/lib/chatFiles", () => ({ releaseChatFile: state.release }));
const expo = "../../../../frontend";
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { useChatDraft } = await import(`${expo}/src/hooks/useChatDraft.ts`);
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.clearAllMocks(); });
it("clears obsolete Chat media at loading without changing text, mentions or reading position", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const attachment = { id: "old", uri: "blob:old", name: "old.png", type: "image/png", size: 12 };
  state.value = { ...emptyRoomDraft(), text: "Keep my text", attachment, staging: { id: 9, nonce: "old", blockId: "old" }, offset: 120 };
  let exposed!: ReturnType<typeof useChatDraft>;
  function Probe() { exposed = useChatDraft("7", 1); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe)));
  expect(exposed.read()).toMatchObject({ text: "Keep my text", mentions: [], offset: 120 });
  expect(state.value.attachment).toBeUndefined();
  expect(state.value.staging).toBeUndefined();
  expect(state.release).toHaveBeenCalledWith(attachment);
  await act(async () => root!.render(createElement(Probe)));
  expect(state.release).toHaveBeenCalledTimes(1);
});
it("preserves uncertain text-only delivery exactly, including its nonce and revision", () => {
  const pending = { body: "Hello", content: { type: "doc" as const, content: [] }, nonce: "same-send", revision: 0 };
  const draft = { ...emptyRoomDraft(), text: "Hello", pending };
  expect(normalizeChatDraft(draft)).toBe(draft);
  expect(normalizeChatDraft(draft).pending).toBe(pending);
});
it("does not retry obsolete media sends or mutate the shared Reply draft value", () => {
  const attachment = { id: "old", uri: "blob:old", name: "old.png", type: "image/png", size: 12 };
  const draft = { ...emptyRoomDraft(), text: "Keep this", attachment, pending: { body: "Keep this", content: { type: "doc" as const, content: [] }, nonce: "media-send", revision: 0, attachment } };
  const normalized = normalizeChatDraft(draft);
  expect(normalized.pending).toBeNull();
  expect(normalized.text).toBe("Keep this");
  expect(draft.attachment).toBe(attachment);
  expect(draft.pending.nonce).toBe("media-send");
});
