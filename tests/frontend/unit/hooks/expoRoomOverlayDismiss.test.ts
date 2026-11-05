import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const expo = "../../../../frontend";
const { act, createElement: h } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { useRoomOverlayDismiss } = await import(`${expo}/src/hooks/useRoomOverlayDismiss.web.ts`);
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; });

it("dismisses the covering panel before Chat and restores Chat Escape ownership after closing it", async () => {
  const closeChat = vi.fn();
  const closeDetails = vi.fn();
  function Probe({ details }: { details: boolean }) {
    useRoomOverlayDismiss(true, closeChat);
    useRoomOverlayDismiss(details, closeDetails);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(h(Probe, { details: false })));
  await act(async () => root!.render(h(Probe, { details: true })));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  expect(closeDetails).toHaveBeenCalledOnce();
  expect(closeChat).not.toHaveBeenCalled();
  await act(async () => root!.render(h(Probe, { details: false })));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  expect(closeChat).toHaveBeenCalledOnce();
});

it("leaves consumed Escape and composition input to the editor or menu", async () => {
  const close = vi.fn();
  function Probe() { useRoomOverlayDismiss(true, close); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(h(Probe)));
  const consumed = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
  consumed.preventDefault();
  window.dispatchEvent(consumed);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, cancelable: true }));
  expect(close).not.toHaveBeenCalled();
});
