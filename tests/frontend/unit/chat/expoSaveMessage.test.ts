import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({ params: { roomId: "7", messageId: "12", request: "stable-chat-save-request" } as Record<string, string | undefined>, setParams: vi.fn(), creation: vi.fn(), create: vi.fn(), save: vi.fn(), back: vi.fn(), feedback: vi.fn(), guard: vi.fn(), release: vi.fn() }));
vi.mock("../../../../frontend/node_modules/expo-router", () => ({ useLocalSearchParams: () => mocks.params, useRouter: () => ({ setParams: mocks.setParams }) }));
vi.mock("../../../../frontend/src/hooks/useRoomNavigation", () => ({ useRoomNavigation: () => ({ back: mocks.back }) }));
vi.mock("../../../../frontend/src/hooks/useDraftNavigation", () => ({ useDraftNavigation: (input: unknown) => { mocks.guard(input); return { release: mocks.release }; } }));
vi.mock("../../../../frontend/src/hooks/useProjectCreation", () => ({ useProjectCreation: (...args: unknown[]) => { mocks.creation(...args); return { submit: mocks.create, isMutating: false }; } }));
vi.mock("../../../../frontend/src/hooks/useChatActions", () => ({
  useThreadMessage: () => ({ data: { id: 12, author: { display_username: "Artist" } } }),
  useChatSave: () => ({ projects: {}, eligible: [], submit: mocks.save, save: { isMutating: false } }),
  useChatSaveFeedback: () => ({ mutate: mocks.feedback }),
}));
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
vi.mock("../../../../frontend/src/components/Icon", () => ({ Icon: () => null }));
vi.mock("../../../../frontend/src/features/projects/ProjectIcon", () => ({ ProjectIcon: () => null }));
const expo = "../../../../frontend";
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { SaveMessageScreen } = await import(`${expo}/src/features/rooms/SaveMessageScreen.tsx`);
let root: Root | undefined;
let container: HTMLDivElement;
beforeEach(() => {
  mocks.params = { roomId: "7", messageId: "12", request: "stable-chat-save-request" };
  mocks.setParams.mockImplementation((params: Record<string, string | undefined>) => {
    Object.assign(mocks.params, params);
    root?.render(createElement(SaveMessageScreen));
  });
});
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; vi.resetAllMocks(); });
it("creates inline with an optional name, preserves the selected message, and retries saving without another project", async () => {
  mocks.create.mockResolvedValue({ id: 23, name: "Untitled" });
  mocks.save.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({});
  container = document.createElement("div"); root = createRoot(container);
  await act(async () => root!.render(createElement(SaveMessageScreen)));
  const click = async (text: string) => act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent === text)!.click(); });
  await click("Create a project");
  await click("Create project and save");
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ name: "Untitled" });
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(23);
  expect(mocks.back).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Created Untitled");
  expect(container.textContent).toContain("Offline");
  await click("Retry save to project");
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(mocks.back).toHaveBeenCalledWith("7", "12");
  expect(mocks.release).toHaveBeenCalledOnce();
});
it("blocks dismissal while project creation is pending", async () => {
  let finish!: (value: unknown) => void;
  mocks.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mocks.save.mockResolvedValue({});
  container = document.createElement("div"); root = createRoot(container);
  await act(async () => root!.render(createElement(SaveMessageScreen)));
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Create a project")!.click());
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Create project and save")!.click());
  expect(mocks.guard.mock.lastCall?.[0].busy).toBe(true);
  expect([...container.querySelectorAll("button")].every(button => button.disabled)).toBe(true);
  await act(async () => { finish({ id: 23, name: "Untitled" }); });
});

it("restores inline project creation with the same request after reload without saving automatically", async () => {
  mocks.params.newProject = "1";
  container = document.createElement("div"); root = createRoot(container);
  await act(async () => root!.render(createElement(SaveMessageScreen)));
  expect(container.textContent).toContain("Create project and save");
  expect(mocks.creation).toHaveBeenLastCalledWith(undefined, "stable-chat-save-request");
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  await act(async () => root!.unmount());
  root = createRoot(container);
  await act(async () => root!.render(createElement(SaveMessageScreen)));
  expect(mocks.creation).toHaveBeenLastCalledWith(undefined, "stable-chat-save-request");
  expect(mocks.save).not.toHaveBeenCalled();
});
