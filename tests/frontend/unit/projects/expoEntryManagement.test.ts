import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({
  destination: vi.fn(), move: vi.fn(), replace: vi.fn(), back: vi.fn(), release: vi.fn(), save: vi.fn(),
  projects: [{ id: 1, name: "Original", viewer_participation: "owner" }, { id: 2, name: "Destination", viewer_participation: "owner" }],
}));
vi.mock("../../../../frontend/node_modules/react-native", async () => {
  const reactPath = "../../../../frontend/node_modules/react/index.js";
  const { createElement } = await import(reactPath) as typeof import("react");
  const View = ({ children }: any) => createElement("div", null, children);
  return { View, Text: View, ScrollView: View, ActivityIndicator: View, Platform: { OS: "web" }, StyleSheet: { create: (value: unknown) => value },
    Animated: { View, Value: class { setValue() {} }, timing: vi.fn(), sequence: vi.fn(), loop: vi.fn() } };
});
vi.mock("../../../../frontend/node_modules/expo-router", () => ({ useRouter: () => ({ replace: mocks.replace }), useLocalSearchParams: () => ({}) }));
vi.mock("../../../../frontend/src/hooks/useProjects", () => ({
  useProject: vi.fn(), useProjectEntry: vi.fn(), useProjects: () => ({ data: { projects: mocks.projects } }),
  useProjectEntryManagement: () => ({ trigger: mocks.move }),
}));
vi.mock("../../../../frontend/src/hooks/useContentDraft", () => ({
  useContentDraft: (options: any) => ({
    content: options.initialContent, dirty: false, status: null, markDirty: vi.fn(), handleChange: vi.fn(),
    saveNow: async () => { mocks.save(); await options.onSave(options.initialContent, 1000); },
  }),
}));
vi.mock("../../../../frontend/src/hooks/useDraftNavigation", () => ({ useDraftNavigation: () => ({ release: mocks.release }) }));
vi.mock("../../../../frontend/src/hooks/useRoomNavigation", () => ({ useRoomNavigation: () => ({ returnTo: mocks.back, destination: mocks.destination }) }));
vi.mock("../../../../frontend/src/hooks/useReducedMotion", () => ({ useReducedMotion: () => true }));
vi.mock("../../../../frontend/src/hooks/useDocumentAttachments", () => ({ useDocumentAttachments: () => ({ pending: false }) }));
vi.mock("../../../../frontend/src/components/Button", async () => {
  const reactPath = "../../../../frontend/node_modules/react/index.js";
  const { createElement } = await import(reactPath) as typeof import("react");
  return { Button: ({ children, onPress, accessibilityLabel, disabled }: any) => createElement("button", { onClick: onPress, "aria-label": accessibilityLabel, disabled }, children) };
});
vi.mock("../../../../frontend/src/components/PopupMenu", async () => {
  const reactPath = "../../../../frontend/node_modules/react/index.js";
  const { createElement } = await import(reactPath) as typeof import("react");
  return { PopupMenu: ({ open, actions, children }: any) => open ? createElement("section", null,
    ...actions.map((action: any) => createElement("button", { key: action.id, onClick: action.onSelect, disabled: action.disabled }, action.label)), children) : null };
});
vi.mock("../../../../frontend/src/components/ViewportShell", async () => {
  const reactPath = "../../../../frontend/node_modules/react/index.js";
  const { createElement } = await import(reactPath) as typeof import("react");
  return { ViewportShell: ({ children }: any) => createElement("main", null, children) };
});
vi.mock("../../../../frontend/src/components/ViewportToolbar", () => ({ ViewportToolbar: () => null }));
vi.mock("../../../../frontend/src/components/Input", () => ({ Input: () => null }));
vi.mock("../../../../frontend/src/components/Icon", () => ({ Icon: () => null }));
vi.mock("../../../../frontend/src/features/content/DocumentEditor", () => ({ DocumentEditor: () => null }));
vi.mock("../../../../frontend/src/features/content/EntryContent", () => ({ EntryContent: () => null }));
vi.mock("../../../../frontend/src/features/content/DocumentAttachmentControls", () => ({ DocumentAttachmentControls: () => null }));
const expo = "../../../../frontend";
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { ProjectEntryEditing } = await import(`${expo}/src/features/projects/ProjectEntryScreen.tsx`);
let root: Root;
afterEach(async () => { await act(async () => root?.unmount()); vi.clearAllMocks(); });
async function setup() {
  const host = document.createElement("div"); root = createRoot(host);
  const save = { trigger: vi.fn().mockResolvedValue({ updated_at: new Date(2000).toISOString() }) };
  await act(async () => root.render(createElement(ProjectEntryEditing, {
    projectId: "1", name: "Original", allowManagement: true, save,
    entry: { id: 10, intent: "Recorded idea", content: { type: "doc", content: [] }, updated_at: new Date(1000).toISOString(), format: "mixed_media" },
  })));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Entry options"]')!.click());
  const click = async (text: string) => act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === text)!.click());
  return { host, click };
}
it("replaces redundant actions and saves the latest revision before moving", async () => {
  const { host, click } = await setup();
  expect(host.textContent).not.toMatch(/Clear title|Save draft/);
  await click("Choose project");
  expect([...host.querySelectorAll("button")].find(button => button.textContent === "Original")!.disabled).toBe(true);
  await click("Destination");
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.move).toHaveBeenCalledWith({ destination: 2, revision: 2000 });
  expect(mocks.release).toHaveBeenCalledOnce();
  expect(mocks.replace).toHaveBeenCalledWith("/app/projects/2/entries/10/edit");
});
it("confirms deletion and returns to the source project", async () => {
  const { click } = await setup();
  await click("Delete");
  expect(mocks.move).not.toHaveBeenCalled();
  await click("Delete entry");
  expect(mocks.move).toHaveBeenCalledWith({ destination: null, revision: 2000 });
  expect(mocks.back).toHaveBeenCalledWith("/app/projects/1");
});
it("keeps the editor open if moving fails", async () => {
  mocks.move.mockRejectedValueOnce(new Error("Project access is required"));
  const { host, click } = await setup();
  await click("Choose project"); await click("Destination");
  expect(mocks.release).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
  // The toolbar owns the floating error; this test replaces it with a presentation stub.
  expect(host.querySelector('[aria-label="Entry options"]')).not.toBeNull();
});


it("saves before opening the same Room-sharing route used by the project view", async () => {
  const { click } = await setup();
  await click("Share with a room");
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.release).toHaveBeenCalledOnce();
  expect(mocks.destination).toHaveBeenCalledWith("/app/projects/1/entries/10/share");
  expect(mocks.move).not.toHaveBeenCalled();
});
it("does not leave the composer when saving before sharing fails", async () => {
  mocks.save.mockImplementationOnce(() => { throw new Error("Offline"); });
  const { click } = await setup();
  await click("Share with a room");
  expect(mocks.release).not.toHaveBeenCalled();
  expect(mocks.destination).not.toHaveBeenCalled();
});

it.each([false, true])("only blocks empty publication, while allowing private draft closure (publish: %s)", async publishing => {
  const host = document.createElement("div"); root = createRoot(host);
  await act(async () => root.render(createElement(ProjectEntryEditing, {
    projectId: "1", name: "Original", save: { trigger: vi.fn() },
    ...(publishing ? { onPublish: vi.fn(), completionLabel: "Submit contribution" } : {}),
    entry: { id: 10, intent: "", content: { type: "doc", content: [] }, updated_at: new Date(1000).toISOString(), format: "mixed_media" },
  })));
  const button = host.querySelector<HTMLButtonElement>(`[aria-label="${publishing ? "Submit contribution" : "Done editing"}"]`)!;
  expect(button.disabled).toBe(publishing);
});
