import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";

const state = vi.hoisted(() => ({ seen: vi.fn(), appState: "active" }));
vi.mock("../../../../frontend/node_modules/react-native", () => ({
  Platform: { OS: "web" },
  AppState: {
    get currentState() { return state.appState; },
    addEventListener: () => ({ remove() {} }),
  },
}));
vi.mock("../../../../frontend/node_modules/expo-router", async () => {
  const path = "../../../../frontend/node_modules/react/index.js";
  const { useEffect } = await import(path);
  return { useFocusEffect: (callback: () => void) => useEffect(callback, [callback]) };
});
vi.mock("../../../../frontend/src/hooks/useRoomReadReceipts", () => ({
  useRoomReadReceipts: () => state.seen,
}));
const expo = "../../../../frontend";
const { act, createElement: h } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { useRoomExposure } = await import(`${expo}/src/hooks/useRoomExposure.ts`);
let root: Root | undefined;
let exposure: ReturnType<typeof useRoomExposure>;
let active = true;
type Measure = (x: number, y: number, width: number, height: number) => void;
const node = (y = 10) => ({ measureInWindow: (callback: Measure) => callback(0, y, 100, 20) });
function Probe() { exposure = useRoomExposure("7", undefined, "chat", active); return null; }
async function mount(initialActive = true) {
  active = initialActive;
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(h(Probe)));
  exposure.viewport.current = { measureInWindow: (callback: Measure) => callback(0, 0, 100, 100) } as never;
  exposure.register(41, node() as never, "group");
  exposure.onViewableItemsChanged({ viewableItems: [{ item: { key: "group" } }] } as never);
}
async function toggle(value: boolean) {
  active = value;
  await act(async () => root!.render(h(Probe)));
}
async function advance(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }
beforeEach(() => {
  vi.useFakeTimers();
  state.appState = "active";
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.restoreAllMocks();
  state.seen.mockClear();
  vi.useRealTimers();
});

it("never reports fetched, viewable rows while the chat drawer is hidden", async () => {
  await mount(false);
  await advance(2000);
  expect(state.seen).not.toHaveBeenCalled();
  await toggle(true);
  await advance(500);
  expect(state.seen).not.toHaveBeenCalled();
  await advance(250);
  expect(state.seen).toHaveBeenCalledExactlyOnceWith(41);
});

it("requires a fresh uninterrupted dwell after details or a shelf covers chat", async () => {
  await mount();
  await advance(500);
  await toggle(false);
  await advance(1000);
  expect(state.seen).not.toHaveBeenCalled();
  await toggle(true);
  await advance(500);
  expect(state.seen).not.toHaveBeenCalled();
  await advance(250);
  expect(state.seen).toHaveBeenCalledExactlyOnceWith(41);
  await toggle(false);
  await toggle(true);
  await advance(1000);
  expect(state.seen).toHaveBeenCalledTimes(1);
});

it("discards outstanding geometry from before chat was hidden", async () => {
  await mount();
  let finish: Measure | undefined;
  exposure.register(41, { measureInWindow: (callback: Measure) => { finish = callback; } } as never, "group");
  await advance(250);
  await toggle(false);
  await toggle(true);
  finish!(0, 10, 100, 20);
  await advance(500);
  finish!(0, 10, 100, 20);
  expect(state.seen).not.toHaveBeenCalled();
  await advance(500);
  finish!(0, 10, 100, 20);
  expect(state.seen).toHaveBeenCalledExactlyOnceWith(41);
});

it("does not count background or nonvisible browser time toward exposure", async () => {
  await mount();
  await advance(500);
  vi.mocked(document.hasFocus).mockReturnValue(false);
  window.dispatchEvent(new Event("blur"));
  await advance(1000);
  expect(state.seen).not.toHaveBeenCalled();
  vi.mocked(document.hasFocus).mockReturnValue(true);
  await advance(500);
  expect(state.seen).not.toHaveBeenCalled();
  await advance(250);
  expect(state.seen).toHaveBeenCalledExactlyOnceWith(41);
});

it("requires per-message geometry even when its group is viewable", async () => {
  await mount();
  exposure.register(41, node(101) as never, "group");
  await advance(1000);
  expect(state.seen).not.toHaveBeenCalled();
  exposure.register(41, node() as never, "group");
  await advance(750);
  expect(state.seen).toHaveBeenCalledExactlyOnceWith(41);
});
