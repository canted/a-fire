import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const state = vi.hoisted(() => ({ record: vi.fn(), pick: vi.fn() }));
vi.mock("../../../../frontend/src/hooks/useReloadBlocker", () => ({ useReloadBlocker() {} }));
vi.mock("../../../../frontend/src/hooks/useReducedMotion", () => ({ useReducedMotion: () => true }));
vi.mock("../../../../frontend/src/hooks/useChatRecording", () => ({ useChatRecording: state.record }));
vi.mock("../../../../frontend/src/lib/chatFiles", () => ({ pickChatFile: state.pick }));
vi.mock("../../../../frontend/src/features/content/LinkPreviewCard", () => ({ LinkPreviewCard: () => null }));
vi.mock("../../../../frontend/src/features/content/DocumentContent", () => ({ DocumentContent: () => null }));
vi.mock("../../../../frontend/src/features/content/RecordingDrawer", () => ({ RecordingDrawer: () => null }));
vi.mock("../../../../frontend/src/components/PopupMenu", async () => {
  const path = "../../../../frontend/node_modules/react/index.js"; const React = await import(path);
  return { PopupMenu: ({ open, children }: any) => open ? React.createElement("div", null, children) : null };
});
vi.mock("../../../../frontend/src/components/AppImage", () => ({ AppImage: () => null }));
vi.mock("../../../../frontend/src/components/Icon", () => ({ Icon: () => null }));
vi.mock("../../../../frontend/node_modules/react-native", async () => {
  const path = "../../../../frontend/node_modules/react/index.js"; const React = await import(path);
  return { Animated: { Value: class { setValue() {} } }, Easing: { linear: (value: number) => value }, Platform: { OS: "web" }, AccessibilityInfo: { announceForAccessibility() {} }, ActivityIndicator: () => null,
    StyleSheet: { create: (s: unknown) => s, absoluteFill: {} },
    Modal: ({ visible, children }: any) => visible ? React.createElement("div", null, children) : null,
    View: ({ children }: any) => React.createElement("div", null, children), Text: ({ children }: any) => React.createElement("span", null, children),
    ScrollView: ({ children, ref }: any) => { React.useImperativeHandle(ref, () => ({ scrollTo() {} })); return React.createElement("div", null, children); } };
});
vi.mock("../../../../frontend/src/components/Button", async () => {
  const path = "../../../../frontend/node_modules/react/index.js"; const React = await import(path);
  return { Button: ({ children, onPress, accessibilityLabel, disabled }: any) => React.createElement("button", { onClick: onPress, "aria-label": accessibilityLabel, disabled }, children) };
});
vi.mock("../../../../frontend/src/components/Input", async () => {
  const path = "../../../../frontend/node_modules/react/index.js"; const React = await import(path);
  return { Input: ({ ref, value, editable, onKeyPress, accessibilityLabel }: any) => React.createElement("textarea", { ref, value, readOnly: true, disabled: !editable, "aria-label": accessibilityLabel, onKeyDown: (event: any) => onKeyPress({ nativeEvent: event, preventDefault: () => event.preventDefault() }) }) };
});
const expo = "../../../../frontend";
const { act, createElement, useState } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { ChatComposer } = await import(`${expo}/src/features/rooms/ChatComposer.tsx`);
const { ReplyComposer } = await import(`${expo}/src/features/entries/ReplyComposer.tsx`);
const { emptyRoomDraft } = await import(`${expo}/src/lib/chatComposition.ts`);
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = undefined; vi.clearAllMocks(); });
async function mount(kind: "chat" | "reply", text = "Hello", pending = false) {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  state.record.mockReturnValue({ recording: false, preparing: false, review: null });
  const send = vi.fn().mockResolvedValue(undefined), replaceAttachment = vi.fn().mockResolvedValue(undefined);
  let latest: any;
  function Fixture() {
    const [value, update] = useState({ ...emptyRoomDraft(), text, pending: pending ? { body: text, nonce: "retry", revision: 0, content: { type: "doc" as const, content: [] } } : null });
    latest = value;
    const draft = { ...value, read: () => value, update: (patch: any) => update((current: typeof value) => ({ ...current, ...(typeof patch === "function" ? patch(current) : patch) })) };
    const composition = { send, replaceAttachment, setError: vi.fn(), error: null, stage: "idle", busy: false, mentions: { data: { targets: [{ id: "user:1", targetType: "user", targetId: "1", label: "Alice", subtitle: null }] } } };
    return createElement(kind === "chat" ? ChatComposer : ReplyComposer, { title: "test", draft, composition } as any);
  }
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(createElement(Fixture)));
  return { send, replaceAttachment, read: () => latest };
}
it("Chat has text/send only and never initializes a recorder", async () => {
  const { send } = await mount("chat");
  expect(host.querySelector('[aria-label="Add attachment"]')).toBeNull();
  expect(state.record).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click());
  expect(send).toHaveBeenCalledOnce();
});
it("Replies retain attachment selection through their own composition owner", async () => {
  const file = { id: "photo", name: "photo.png" }; state.pick.mockResolvedValue(file);
  const { replaceAttachment } = await mount("reply");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Add attachment"]')!.click());
  expect(host.textContent).toContain("Record audio");
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === "Choose photo or file")!.click());
  expect(replaceAttachment).toHaveBeenCalledWith(file);
});
it.each(["chat", "reply"] as const)("%s uses the shared mention selection and send behavior", async kind => {
  const { read, send } = await mount(kind, "@Al");
  await act(async () => host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  expect(read().text).toBe("@Alice ");
  expect(read().mentions[0].target.targetId).toBe("1");
  expect(send).not.toHaveBeenCalled();
  await act(async () => host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  expect(send).toHaveBeenCalledOnce();
});
it("Chat freezes uncertain text but keeps Retry send available", async () => {
  const { send } = await mount("chat", "Keep this message", true);
  expect(host.querySelector('textarea')!.disabled).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Retry send"]')!.click());
  expect(send).toHaveBeenCalledOnce();
});
