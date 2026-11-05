import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({ convert: vi.fn() }));
vi.mock("../../../../frontend/src/lib/chatFiles", () => ({ browserChatFile: mocks.convert }));
const expo = "../../../../frontend";
const { act, createElement: h } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { useReplyPaste } = await import(`${expo}/src/hooks/useReplyPaste.web.ts`);
const { useChatPaste } = await import(`${expo}/src/hooks/useChatPaste.web.ts`);
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.clearAllMocks(); });
async function composer(chat: boolean) {
  const input = document.createElement("textarea");
  input.value = "Keep the existing text";
  const attach = vi.fn().mockResolvedValue(undefined);
  const ref = { current: input };
  function ChatProbe() { useChatPaste(ref as never, true); return null; }
  function ReplyProbe() { useReplyPaste(ref as never, attach, true); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(h(chat ? ChatProbe : ReplyProbe)));
  return { input, attach };
}
function paste(file: File, text = "") {
  const event = new Event("paste", { cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: {
    items: [{ kind: "file", getAsFile: () => file }], files: [file], getData: (type: string) => type === "text/plain" ? text : "",
  } });
  return event;
}
it.each(["image/png", "audio/wav", "video/mp4", "application/pdf"])("blocks binary-only %s in Chat without attaching or changing text", async type => {
  const { input, attach } = await composer(true);
  const event = paste(new File(["synthetic"], "fixture", { type }));
  await act(async () => { input.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(input.value).toBe("Keep the existing text");
  expect(attach).not.toHaveBeenCalled();
  expect(mocks.convert).not.toHaveBeenCalled();
});
it("allows native plain-text insertion for mixed clipboard contents while rejecting the media", async () => {
  const { input, attach } = await composer(true);
  const event = paste(new File(["synthetic"], "fixture.png", { type: "image/png" }), "Keep this link: https://example.com/");
  await act(async () => { input.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(false);
  expect(attach).not.toHaveBeenCalled();
});
it("blocks file drops in Chat without creating an attachment", async () => {
  const { input, attach } = await composer(true);
  const event = new Event("drop", { cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files: [new File(["synthetic"], "fixture.png", { type: "image/png" })] } });
  await act(async () => { input.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(attach).not.toHaveBeenCalled();
  expect(input.value).toBe("Keep the existing text");
});
it("retains the canonical media-paste path for entry feedback", async () => {
  const { input, attach } = await composer(false);
  const file = new File(["synthetic"], "fixture.png", { type: "image/png" });
  const attachment = { id: "fixture" };
  mocks.convert.mockReturnValue(attachment);
  const event = paste(file);
  await act(async () => { input.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(mocks.convert).toHaveBeenCalledExactlyOnceWith(file);
  expect(attach).toHaveBeenCalledExactlyOnceWith(attachment);
});
