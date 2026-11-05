vi.mock("../../../../frontend/src/hooks/useRoomBenchmark", () => ({ markRoomNavigation: vi.fn() }));
import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const state = vi.hoisted(() => ({
  push: vi.fn(),
  details: vi.fn(),
  walls: [{ id: "9", presented: true }],
  dismiss: vi.fn((done: () => void) => done()),
}));
vi.mock("../../../../frontend/node_modules/expo-router", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("../../../../frontend/src/hooks/useRoomDetails", () => ({
  useRoomDetails: (...args: unknown[]) => {
    state.details(...args);
    return {};
  },
}));
vi.mock("../../../../frontend/src/hooks/useRoundResult", () => ({
  useRoundResult: () => ({
    walls: { data: { walls: state.walls }, isLoading: false },
    dismiss: state.dismiss,
  }),
}));
vi.mock("../../../../frontend/src/hooks/useRoomDetailsPresence", () => ({
  useRoomDetailsPresence: (open: boolean) => ({ present: open }),
}));
vi.mock("../../../../frontend/src/hooks/useRoomWallMotion", () => ({
  useRoomWallMotion: (open: boolean) => ({
    present: open,
    transition: (_direction: string, done: () => void) => done(),
  }),
}));
const expo = "../../../../frontend";
const { act, createElement: h } = (await import(
  `${expo}/node_modules/react/index.js`
)) as typeof import("react");
const { createRoot } = (await import(
  `${expo}/node_modules/react-dom/client.js`
)) as typeof import("react-dom/client");
const { useRoomWorkspace } = await import(
  `${expo}/src/hooks/useRoomWorkspace.ts`
);
let root: Root;
let workspace: ReturnType<typeof useRoomWorkspace>;
afterEach(async () => {
  await act(async () => root?.unmount());
  vi.clearAllMocks();
  state.walls = [{ id: "9", presented: true }];
});
async function mount(options: Parameters<typeof useRoomWorkspace>[0]) {
  function Probe() {
    workspace = useRoomWorkspace(options);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(h(Probe)));
}
it("coordinates exclusive details/shelf state and dismisses a Wall through its receipt owner", async () => {
  const onWallChange = vi.fn();
  await mount({ room: "1", access: "member", onWallChange });
  await act(async () => workspace.toggleDetails());
  expect(workspace.detailsOpen).toBe(true);
  expect(state.details).toHaveBeenLastCalledWith("1", true, "member");
  await act(async () => workspace.toggleShelf());
  expect(workspace.detailsOpen).toBe(false);
  expect(workspace.shelfOpen).toBe(true);
  await act(async () => workspace.expandShelf());
  expect(workspace.detailsOpen).toBe(true);
  expect(workspace.shelfOpen).toBe(false);
  await act(async () => workspace.openWall());
  expect(workspace.wallOpen).toBe(false);
  expect(state.push).toHaveBeenCalledWith("/app/rooms/1/round-history");
  expect(workspace.detailsOpen).toBe(false);
  await act(async () => workspace.selectWall("10"));
  expect(onWallChange).toHaveBeenCalledWith("10");
  const navigate = vi.fn();
  await act(async () => workspace.leaveWall(navigate));
  expect(state.dismiss).toHaveBeenCalledOnce();
  expect(navigate).toHaveBeenCalledOnce();
  expect(workspace.wallOpen).toBe(false);
});
it("retains Chat-only arrival presentation and requested-Wall dismissal", async () => {
  state.walls = [{ id: "9", presented: false }];
  const onWallChange = vi.fn();
  await mount({
    room: "1",
    access: "member",
    requestedWall: "9",
    presentOnArrival: true,
    onWallChange,
  });
  expect(workspace.wallOpen).toBe(true);
  await act(async () => workspace.closeWall());
  expect(onWallChange).toHaveBeenCalledWith(undefined);
  expect(workspace.wallOpen).toBe(false);
});
it("does not automatically present unread Walls in ordinary workspaces", async () => {
  state.walls = [{ id: "9", presented: false }];
  await mount({ room: "1", access: "visitor" });
  expect(workspace.wallOpen).toBe(false);
  expect(state.dismiss).not.toHaveBeenCalled();
});

it("opens details when returning from settings and still allows closing them", async () => {
  await mount({ room: "4", access: "member", requestedDetails: true });
  expect(workspace.detailsOpen).toBe(true);
  expect(state.details).toHaveBeenLastCalledWith("4", true, "member");
  await act(async () => workspace.closeDetails());
  expect(workspace.detailsOpen).toBe(false);
});
