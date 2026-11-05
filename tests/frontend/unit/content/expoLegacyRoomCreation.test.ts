import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({ params: {} as Record<string, string | undefined>, room: vi.fn(), round: vi.fn(), editor: vi.fn(), draft: vi.fn() }));
vi.mock("../../../../frontend/node_modules/expo-router", () => ({ useLocalSearchParams: () => mocks.params, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("../../../../frontend/src/hooks/useRoomNavigation", () => ({ useRoomNavigation: () => ({ returnTo: vi.fn(), home: vi.fn() }) }));
vi.mock("../../../../frontend/src/hooks/useRounds", () => ({ useRoundDetail: (id?: string) => ({ data: id ? { round: { id, roomId: "7" } } : undefined }) }));
vi.mock("../../../../frontend/src/hooks/useEntryDraft", () => ({ useEntryDraft: () => ({ draft: { data: mocks.draft() } }) }));
vi.mock("../../../../frontend/src/features/projects/RoomEntryScreen", () => ({ RoomEntryFlow: (props: unknown) => { mocks.room(props); return "Project-backed Room flow"; } }));
vi.mock("../../../../frontend/src/features/rounds/RoundContribution", () => ({
  RoundContribution: (props: unknown) => { mocks.round(props); return "Project-backed Round flow"; },
  EntryContributionEditor: (props: unknown) => { mocks.editor(props); return "Prepared copy recovery"; },
}));
vi.mock("../../../../frontend/src/components/ViewportShell", async () => {
  const path = "../../../../frontend/node_modules/react/index.js"; const React = await import(path);
  return { ViewportShell: ({ children }: any) => React.createElement("div", null, children) };
});
vi.mock("../../../../frontend/node_modules/react-native", async () => {
  const path = "../../../../frontend/node_modules/react/index.js"; const React = await import(path);
  const Box = ({ children }: any) => React.createElement("div", null, children);
  return { View: Box, Text: Box, ActivityIndicator: Box, StyleSheet: { create: (value: unknown) => value } };
});
vi.mock("../../../../frontend/src/components/Button", async () => {
  const path = "../../../../frontend/node_modules/react/index.js"; const React = await import(path);
  return { Button: ({ children, onPress }: any) => React.createElement("button", { onClick: onPress }, children) };
});
const expo = "../../../../frontend";
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { EntryComposerScreen } = await import(`${expo}/src/features/entries/EntryComposerScreen.tsx`);
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; vi.clearAllMocks(); });
async function render(params: Record<string, string | undefined>) {
  mocks.params = params;
  const container = document.createElement("div"); root = createRoot(container);
  await act(async () => root!.render(createElement(EntryComposerScreen)));
  return container;
}
it.each([{ squareId: "22" }, { square_id: "22" }, { squareId: "22", roundId: "9" }])("does not allocate content from retired Square links: %j", async params => {
  expect((await render(params)).textContent).toContain("Open a room to create an entry.");
  expect(mocks.room).not.toHaveBeenCalled();
  expect(mocks.round).not.toHaveBeenCalled();
  expect(mocks.editor).not.toHaveBeenCalled();
});
it("reopens a prepared Round copy using its persisted Room context", async () => {
  mocks.draft.mockReturnValue({ id: 41, room_id: 7, source_entry_id: 18, round_id: 9 });
  await render({ draftId: "41" });
  expect(mocks.round).toHaveBeenCalledWith(expect.objectContaining({ existingDraft: "41", kind: "submission", detail: { round: { id: "9", roomId: "7" } } }));
  expect(mocks.editor).not.toHaveBeenCalled();
});
it("retains an older unassociated draft without exposing a publish editor", async () => {
  mocks.draft.mockReturnValue({ id: 41, room_id: 7 });
  expect((await render({ draftId: "41" })).textContent).toContain("retained, but cannot be shared");
  expect(mocks.editor).not.toHaveBeenCalled();
  expect(mocks.room).not.toHaveBeenCalled();
});
it("allows recovery of an already prepared Project-backed copy", async () => {
  mocks.draft.mockReturnValue({ id: 41, room_id: 7, source_entry_id: 18 });
  await render({ draftId: "41" });
  expect(mocks.editor).toHaveBeenCalledOnce();
  expect(mocks.room).not.toHaveBeenCalled();
});
