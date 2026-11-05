import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({ ancestor: vi.fn(), open: vi.fn() }));
vi.mock("../../../../frontend/node_modules/react-native", async () => {
  const reactPath = "../../../../frontend/node_modules/react/index.js";
  const { createElement: h } = await import(reactPath) as typeof import("react");
  const flat = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : style || {};
  const View = ({ children, style, dataSet }: any) => h("div", { "data-style": JSON.stringify(flat(style)), "data-viewport-bottom-controls": dataSet?.viewportBottomControls }, children);
  const ScrollView = ({ children, style }: any) => h("div", { "data-scroll": true, "data-style": JSON.stringify(flat(style)) }, children);
  return { View, Text: View, ScrollView, ActivityIndicator: View, Platform: { OS: "web" },
    StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: "absolute", inset: 0 } },
    Animated: { View }, Keyboard: { dismiss() {} }, AccessibilityInfo: { announceForAccessibility() {} } };
});
vi.mock("../../../../frontend/node_modules/expo-router", () => ({ useLocalSearchParams: () => ({ roomId: "4" }), useRouter: () => ({}) }));
vi.mock("../../../../frontend/src/hooks/useRoomNavigation", () => ({ useRoomNavigation: () => ({ ancestor: mocks.ancestor }) }));
vi.mock("../../../../frontend/src/hooks/useContentLink", () => ({ useContentLink: () => ({ open: mocks.open }) }));
vi.mock("../../../../frontend/src/hooks/useRoomDetails", () => ({ useRoomDetails: vi.fn() }));
vi.mock("../../../../frontend/src/hooks/useRoomWorkspace", () => ({ useRoomWorkspace: vi.fn() }));
vi.mock("../../../../frontend/src/hooks/useRoomDetailsInteraction", () => ({ useRoomDetailsInteraction: () => ({
  selection: [], mode: "details", note: "", carry: { targetRef: () => undefined }, changeMode() {},
}) }));
vi.mock("../../../../frontend/src/hooks/useViewportGeometry", () => ({ useViewportGeometry: () => ({ keyboardOpen: false }) }));
vi.mock("../../../../frontend/src/hooks/useRoomDetailsPresence", () => ({ useRoomDetailsPresence: () => ({ present: false }) }));
vi.mock("../../../../frontend/src/features/rooms/RoundResultView", () => ({ RoundResultView: () => null }));
vi.mock("../../../../frontend/src/components/ViewportShell", async () => {
  const reactPath = "../../../../frontend/node_modules/react/index.js";
  const { createElement: h } = await import(reactPath) as typeof import("react");
  return { ViewportShell: ({ children }: any) => h("main", null, children) };
});
vi.mock("../../../../frontend/src/components/Button", async () => {
  const reactPath = "../../../../frontend/node_modules/react/index.js";
  const { createElement: h } = await import(reactPath) as typeof import("react");
  return { Button: ({ children, accessibilityLabel, onPress, style }: any) => h("button", { "aria-label": accessibilityLabel, onClick: onPress, "data-style": JSON.stringify(Object.assign({}, ...[style].flat().filter(Boolean))) }, children) };
});
vi.mock("../../../../frontend/src/components/Icon", () => ({ Icon: () => null }));
vi.mock("../../../../frontend/src/components/RoomIcon", () => ({ RoomIcon: () => null }));
vi.mock("../../../../frontend/src/components/UserAvatar", () => ({ UserAvatar: () => null }));
vi.mock("../../../../frontend/src/components/Input", () => ({ Input: () => null }));
vi.mock("../../../../frontend/src/components/Select", () => ({ Select: () => null }));
vi.mock("../../../../frontend/src/components/Checkbox", () => ({ Checkbox: () => null }));
vi.mock("../../../../frontend/src/components/AppImage", () => ({ AppImage: () => null }));
vi.mock("../../../../frontend/src/components/PopupMenu", () => ({ PopupMenu: () => null }));
vi.mock("../../../../frontend/src/lib/chatFiles", () => ({ releaseChatFile: vi.fn() }));
vi.mock("../../../../frontend/src/features/invites/RoomInvitesScreen", () => ({ RoomInvites: () => null }));
vi.mock("../../../../frontend/src/hooks/useRoomManagement", () => ({ useRoomManagement: () => ({
  room: { data: { id: 4, name: "Studio", replySettings: { replyMode: "simple" } } },
  members: {}, joins: {}, knocks: {}, allowed: true, host: false,
}) }));
const expo = "../../../../frontend";
const { act, createElement: h } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { RoomDetails } = await import(`${expo}/src/features/rooms/RoomDetails.tsx`);
const { RoomWorkspaceFrame } = await import(`${expo}/src/features/rooms/RoomWorkspace.tsx`);
const { RoomSettingsScreen } = await import(`${expo}/src/features/roomSettings/RoomSettingsScreen.tsx`);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
afterEach(async () => { await act(async () => root?.unmount()); vi.clearAllMocks(); });
const details = {
  room: { data: { id: 4, name: "Studio", porosity: "closed", access: { kind: "member", can_manage: true, can_view_notes: true } } },
  members: { data: { members: [] } }, sides: { data: { adjacent_rooms: [] } }, action: {}, ancestry: {},
};
async function render(element: React.ReactNode) {
  const host = document.createElement("div"); root = createRoot(host);
  await act(async () => root.render(element)); return host;
}
it("keeps compact footer links outside the member and side-room scroll area", async () => {
  const host = await render(h(RoomDetails, { details, close() {} }));
  const scroll = host.querySelector("[data-scroll]")!;
  expect(scroll.textContent).toContain("Members");
  expect(scroll.textContent).toContain("Side Rooms");
  for (const label of ["Rounds", "Notifications", "Notes", "Settings"]) {
    const button = host.querySelector(`[aria-label="${label}"]`)!;
    expect(button).not.toBeNull(); expect(scroll.contains(button)).toBe(false);
    expect(button.closest("[data-viewport-bottom-controls]")).not.toBeNull();
  }
  expect(host.textContent).not.toMatch(/Current and previous|Choose what reaches|Shared notes for|Manage this/);
});
it("clips the moving details below the header and retains both room navigation controls", async () => {
  const workspace = {
    details: { ...details, sides: { data: { adjacent_rooms: [{ id: 5, actions: {} }] } } },
    detailsOpen: true, shelfOpen: false, wallOpen: false,
    presence: { present: true, style: { transform: [{ translateY: -500 }] } },
    shelf: { present: false }, wallMotion: { present: false },
    walls: { walls: {} }, detailsRef: { current: null }, shelfRef: { current: null },
    closeDetails() {}, toggleDetails() {}, toggleShelf() {},
  };
  const host = await render(h(RoomWorkspaceFrame, { room: "4", workspace, title: "Studio", backLabel: "Parent room", onBack() {}, navigate() {}, children: null }));
  expect(host.querySelector('[aria-label="Parent room"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Open Side Rooms shelf"]')).not.toBeNull();
  const clip = [...host.querySelectorAll("[data-style]")].find(node => {
    const style = JSON.parse(node.getAttribute("data-style")!);
    return style.overflow === "hidden" && style.top === 64;
  });
  expect(clip).toBeDefined();
  expect(clip!.querySelector('[aria-label="Close Room details"]')).toBeNull();
});
it("renders settings without duplicate keys or room-tree navigation and returns to details", async () => {
  const error = vi.spyOn(console, "error");
  try {
    const host = await render(h(RoomSettingsScreen));
    expect(host.textContent).toContain("Room name");
    expect(host.textContent).toContain("Reply settings");
    expect(error.mock.calls.flat().join(" ")).not.toContain("same key");
    expect(host.querySelector('[aria-label="Open Side Rooms shelf"]')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Back to room details"]')!.click());
    expect(mocks.ancestor).toHaveBeenCalledWith("/app/rooms/4?panel=details");
  } finally { error.mockRestore(); }
});

it("marks only eligible side rooms throughout a drag and strengthens the hovered target", async () => {
  const { RoomSideList } = await import(`${expo}/src/features/rooms/RoomDetails.tsx`);
  const drag = { drag: { user: 3, x: 10, y: 0, target: "side:5" }, targetRef: () => undefined };
  const room = (id: number, invite: boolean) => ({ id, name: `Side ${id}`, porosity: "open", actions: { enter: true, invite }, member_count: 2 });
  const host = await render(h(RoomSideList, { details: { ...details, action: {}, sides: { data: { adjacent_rooms: [room(5, true), room(6, true), room(7, false)] } } }, drag, activate() {} }));
  const frames = [...host.querySelectorAll('[data-style]')].map(node => JSON.parse(node.getAttribute('data-style')!));
  const targets = frames.filter(style => style.outlineStyle === 'solid');
  expect(targets).toHaveLength(2);
  expect(targets.every(style => style.outlineWidth === 1 && style.borderRadius === 8)).toBe(true);
  expect(targets[0].outlineColor).toBe(targets[1].outlineColor);
  expect(targets[0].backgroundColor).not.toBe(targets[1].backgroundColor);
  expect(frames.filter(style => style.outlineStyle === 'dashed')).toHaveLength(0);
});
