import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({ params: {} as Record<string, string>, setParams: vi.fn(), entry: vi.fn(), editor: vi.fn(), owned: true, listed: true, projectsError: undefined as Error | undefined, entryError: undefined as Error | undefined, canEdit: true, refreshProjects: vi.fn(), createProject: vi.fn() }));
vi.mock("../../../../frontend/node_modules/expo-router", () => ({ useLocalSearchParams: () => mocks.params, useRouter: () => ({ setParams: mocks.setParams }) }));
vi.mock("../../../../frontend/src/hooks/useRoomNavigation", () => ({ useRoomNavigation: () => ({ returnTo: vi.fn() }) }));
vi.mock("../../../../frontend/src/hooks/useDraftNavigation", () => ({ useDraftNavigation: () => ({}) }));
vi.mock("../../../../frontend/src/hooks/useProjectCreation", () => ({ useProjectCreation: () => ({ isMutating: false, submit: mocks.createProject }) }));
vi.mock("../../../../frontend/src/hooks/useRoomEntryPublication", () => ({ useRoomEntryPublication: () => ({ prepared: false }) }));
vi.mock("../../../../frontend/src/hooks/useProjects", () => ({
 useProjects: () => ({ mutate: mocks.refreshProjects, error: mocks.projectsError, data: { projects: mocks.listed ? [{ id: 12, name: "Private original", viewer_participation: mocks.owned ? "owner" : "member" }] : [] } }),
 useProject: (id: string | undefined) => ({ error: mocks.projectsError, mutate: mocks.refreshProjects, data: id ? { id: 12, name: "Private original", viewer_participation: mocks.owned ? "owner" : "accepted" } : undefined }),
 useProjectEntry: (...args: unknown[]) => { mocks.entry(...args); return { query: { error: mocks.entryError, data: { id: 41, can_edit: mocks.canEdit } }, save: {} }; },
}));
vi.mock("../../../../frontend/src/features/projects/ProjectEntryScreen", () => ({ ProjectEntryEditing: (props: unknown) => { mocks.editor(props); return "Canonical Project editor"; } }));
vi.mock("../../../../frontend/src/components/Select", async () => {
 const path = "../../../../frontend/node_modules/react/index.js"; const React = await import(path);
 return { Select: ({ onValueChange }: any) => React.createElement("button", { onClick: () => onValueChange("new") }, "Create project") };
});
vi.mock("../../../../frontend/src/components/ViewportShell", async () => {
 const path = "../../../../frontend/node_modules/react/index.js"; const React = await import(path);
 return { ViewportShell: ({ children }: any) => React.createElement("div", null, children) };
});
vi.mock("../../../../frontend/node_modules/react-native", async () => {
  const path = "../../../../frontend/node_modules/react/index.js";
  const React = await import(path);
  const Box = ({ children }: any) => React.createElement("div", null, children);
  return { View: Box, Text: Box, ScrollView: Box, Modal: Box, ActivityIndicator: Box, Platform: { OS: "web" }, StyleSheet: { create: (value: unknown) => value } };
});
vi.mock("../../../../frontend/node_modules/react-native-safe-area-context", async () => {
  const path = "../../../../frontend/node_modules/react/index.js"; const React = await import(path);
  return { SafeAreaView: ({ children }: any) => React.createElement("div", null, children) };
});
vi.mock("../../../../frontend/src/components/Button", async () => {
  const path = "../../../../frontend/node_modules/react/index.js"; const React = await import(path);
  return { Button: ({ children, onPress, disabled, accessibilityLabel }: any) => React.createElement("button", { onClick: onPress, disabled, "aria-label": accessibilityLabel }, children) };
});
vi.mock("../../../../frontend/src/components/Input", async () => {
  const path = "../../../../frontend/node_modules/react/index.js"; const React = await import(path);
  return { Input: ({ value, editable }: any) => React.createElement("input", { value, readOnly: true, disabled: !editable }) };
});

const expo = "../../../../frontend";
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { RoomEntryFlow } = await import(`${expo}/src/features/projects/RoomEntryScreen.tsx`);
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; vi.clearAllMocks(); mocks.owned = true; mocks.listed = true; mocks.canEdit = true; mocks.projectsError = undefined; mocks.entryError = undefined; });
async function render() { const container = document.createElement("div"); root = createRoot(container); await act(async () => root!.render(createElement(RoomEntryFlow, { room: "7" }))); return container; }
it("pins the allocated private draft in the route before allowing edits", async () => {
 mocks.params = { sourceRequest: "stable-source-request", sourceProject: "12" };
 const container = await render();
 expect(mocks.entry).toHaveBeenCalledWith("12", undefined, true, "stable-source-request");
 expect(mocks.setParams).toHaveBeenCalledWith({ sourceEntry: "41" });
 expect(container.textContent).not.toContain("Canonical Project editor");
});
it("reopens the exact draft after reload without allocating a new source", async () => {
 mocks.params = { sourceRequest: "stable-source-request", sourceProject: "12", sourceEntry: "41" };
 const container = await render();
 expect(mocks.entry).toHaveBeenCalledWith("12", "41", false, "stable-source-request");
 expect(mocks.setParams).not.toHaveBeenCalled();
 expect(container.textContent).toContain("Canonical Project editor");
});
it("does not replace or open a source after project ownership is lost", async () => {
 mocks.params = { sourceRequest: "stable-source-request", sourceProject: "12", sourceEntry: "41" }; mocks.owned = false;
 const container = await render();
 expect(mocks.entry).not.toHaveBeenCalled();
 expect(container.textContent).toContain("Your work has not been moved or replaced");
});

it("keeps a started share locked after reload while leaving an explicit retry action", async () => {
 mocks.params = { sourceRequest: "stable-source-request", sourceProject: "12", sourceEntry: "41", shareStarted: "1" };
 await render();
 expect(mocks.editor.mock.lastCall?.[0].editingLocked).toBe(true);
 expect(mocks.editor.mock.lastCall?.[0].onPublish).toBeTypeOf("function");
});

it("does not trust cached ownership after the project access request fails", async () => {
 mocks.params = { sourceRequest: "stable-source-request", sourceProject: "12", sourceEntry: "41" };
 mocks.projectsError = new Error("Access revoked");
 const container = await render();
 expect(mocks.entry).not.toHaveBeenCalled();
 expect(mocks.editor).not.toHaveBeenCalled();
 expect(container.textContent).toContain("Your work has not been moved or replaced");
});
it.each(["request failed", "editing revoked"])("blocks the cached private editor when %s", async reason => {
 mocks.params = { sourceRequest: "stable-source-request", sourceProject: "12", sourceEntry: "41" };
 if (reason === "request failed") mocks.entryError = new Error("Entry unavailable");
 else mocks.canEdit = false;
 const container = await render();
 expect(mocks.entry).toHaveBeenCalledWith("12", "41", false, "stable-source-request");
 expect(mocks.editor).not.toHaveBeenCalled();
 expect(container.textContent).toContain("unavailable for editing");
 expect(mocks.setParams).not.toHaveBeenCalled();
});

it("keeps a newly created project out of the editor until its canonical list refresh succeeds", async () => {
 mocks.params = { sourceRequest: "stable-source-request" };
 mocks.createProject.mockResolvedValue({ id: 13, name: "Untitled" });
 mocks.refreshProjects.mockRejectedValueOnce(new Error("Could not verify project access"));
 const container = await render();
 await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Create a project")!.click(); });
 await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Continue")!.click(); });
 expect(mocks.createProject).toHaveBeenCalledWith({ name: "Untitled" });
 expect(mocks.refreshProjects).toHaveBeenCalledOnce();
 expect(mocks.setParams).not.toHaveBeenCalled();
 expect(mocks.editor).not.toHaveBeenCalled();
 expect(container.textContent).toContain("Could not verify project access");
 mocks.refreshProjects.mockResolvedValueOnce({});
 await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Continue")!.click(); });
 expect(mocks.setParams).toHaveBeenCalledWith({ sourceProject: "13" });
});

it("reopens an authorized source that is outside the loaded Project page", async () => {
 mocks.listed = false;
 mocks.params = { sourceProject: "12", sourceEntry: "41", sourceRequest: "stable-source-request" };
 await render();
 expect(mocks.entry).toHaveBeenCalledWith("12", "41", false, "stable-source-request");
 expect(mocks.editor).toHaveBeenCalled();
});

vi.mock("../../../../frontend/src/hooks/useRoomManagement", () => ({ useManagedRoom: () => ({ room: { data: { name: "Studio", avatar_url: null } } }) }));
vi.mock("../../../../frontend/src/hooks/useRoomIdentityPreview", () => ({ useRoomIdentityPreview: () => ({ name: "Studio" }) }));
vi.mock("../../../../frontend/src/components/RoomIcon", () => ({ RoomIcon: () => null }));
vi.mock("../../../../frontend/src/components/Icon", () => ({ Icon: () => null }));
vi.mock("../../../../frontend/src/features/projects/ProjectIcon", () => ({ ProjectIcon: () => null }));
vi.mock("../../../../frontend/src/components/PageScrollView", () => ({ PageScrollView: ({ children }: any) => children }));
it("uses the shared project listing and room-specific creation labels", async () => {
 mocks.params = { sourceRequest: "stable-source-request" };
 const host = await render();
 expect(host.textContent).toContain("Share in Studio");
 expect(host.textContent).toContain("Back to Studio");
 expect(host.textContent).not.toMatch(/New Room entry|Keep the original|Continue to entry/);
 await act(async () => { [...host.querySelectorAll("button")].find(button => button.textContent === "Private original")!.click(); });
 await act(async () => { [...host.querySelectorAll("button")].find(button => button.textContent === "Continue")!.click(); });
 expect(mocks.setParams).toHaveBeenCalledWith({ sourceProject: "12" });
});
