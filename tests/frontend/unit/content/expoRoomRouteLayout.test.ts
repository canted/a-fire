import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";

const state = vi.hoisted(() => ({ path: "/app/rooms/7/chat", mounted: vi.fn(), unmounted: vi.fn(), params: {} as Record<string, string>, props: {} as { chatOpen: boolean; covered: boolean; roomId?: string; routeParams?: Record<string, string> }, options: undefined as any }));
vi.mock("../../../../frontend/node_modules/expo-router", () => ({
  useLocalSearchParams: () => ({ roomId: "7" }),
  usePathname: () => state.path,
  useGlobalSearchParams: () => state.params,
  Stack: ({ screenOptions }: any) => { state.options = screenOptions; return null; },
}));
vi.mock("../../../../frontend/src/features/app/SessionLayout", () => ({ SessionGate: ({ children }: any) => children }));
vi.mock("../../../../frontend/node_modules/react-native", async () => {
  const path = "../../../../frontend/node_modules/react/index.js";
  const { createElement } = await import(path);
  return { View: ({ children }: any) => createElement("div", null, children), StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} } };
});
vi.mock("../../../../frontend/src/features/rooms/RoomScreen", async () => {
  const path = "../../../../frontend/node_modules/react/index.js";
  const { useEffect } = await import(path);
  return { RoomScreen: (props: typeof state.props) => {
    state.props = props;
    useEffect(() => { state.mounted(); return () => state.unmounted(); }, []);
    return "Room workspace";
  } };
});
const expo = "../../../../frontend";
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { RoomRouteLayout } = await import(`${expo}/src/features/rooms/RoomRouteLayout.tsx`);
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.clearAllMocks(); });
async function navigate(path: string) {
  state.path = path;
  root ??= createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(RoomRouteLayout)));
}
it("preserves the same workspace behind Save and suspends its reading until dismissal", async () => {
  await navigate("/app/rooms/7/chat");
  expect(state.props).toMatchObject({ chatOpen: true, covered: false });
  await navigate("/app/rooms/7/chat/messages/41/save");
  expect(state.mounted).toHaveBeenCalledTimes(1);
  expect(state.unmounted).not.toHaveBeenCalled();
  expect(state.props).toMatchObject({ chatOpen: true, covered: true });
  expect(state.options({ route: { name: "chat/messages/[messageId]/save" } })).toMatchObject({ presentation: "transparentModal" });
  await navigate("/app/rooms/7/chat");
  expect(state.props).toMatchObject({ chatOpen: true, covered: false });
  expect(state.mounted).toHaveBeenCalledTimes(1);
  expect(state.unmounted).not.toHaveBeenCalled();
  await navigate("/app/rooms/7/new-entry");
  expect(state.unmounted).toHaveBeenCalledTimes(1);
});

it("passes active Chat link parameters into the persistent workspace without remounting", async () => {
  state.params = {};
  await navigate("/app/rooms/7/chat");
  state.params = { wall: "146", message: "41" };
  await navigate("/app/rooms/7/chat");
  expect(state.props.routeParams).toEqual({ wall: "146", message: "41" });
  expect(state.mounted).toHaveBeenCalledTimes(1);
  state.params = {};
});

it("renders the destination workspace when a sibling Room changes the active route identity", async () => {
  state.params = { roomId: "8" };
  await navigate("/app/rooms/8");
  expect(state.props).toMatchObject({ roomId: "8", chatOpen: false });
  expect(state.mounted).toHaveBeenCalledTimes(1);
  state.params = { roomId: "7" };
  await navigate("/app/rooms/7");
  expect(state.props.roomId).toBe("7");
  state.params = {};
});
