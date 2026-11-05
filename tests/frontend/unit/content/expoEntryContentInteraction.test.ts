import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
vi.mock("../../../../frontend/node_modules/react-native", async () => {
  const path = "../../../../frontend/node_modules/react/index.js";
  const { createElement: h, useEffect } = await import(path);
  return { Platform: { OS: "web" }, StyleSheet: { create: (value: unknown) => value },
    View: ({ children, onLayout }: any) => { useEffect(() => { onLayout?.({ nativeEvent: { layout: { width: 400 } } }); }, []); return h("div", null, children); },
    Text: ({ children }: any) => h("span", null, children),
  };
});
vi.mock("../../../../frontend/src/components/Button", async () => {
  const path = "../../../../frontend/node_modules/react/index.js"; const { createElement: h } = await import(path);
  return { Button: ({ children, onPress, accessibilityLabel }: any) => h("button", { onClick: onPress, "aria-label": accessibilityLabel }, children) };
});
vi.mock("../../../../frontend/src/components/Icon", () => ({ Icon: () => null }));
vi.mock("../../../../frontend/src/components/UserIdentity", () => ({ UserIdentityName: ({ username }: any) => username }));
vi.mock("../../../../frontend/src/features/content/DocumentMedia", async () => {
  const path = "../../../../frontend/node_modules/react/index.js"; const { createElement: h } = await import(path);
  return { DocumentMedia: ({ previewOnly }: any) => previewOnly ? h("span", null, "Audio preview") : h("button", null, "Play audio") };
});
vi.mock("../../../../frontend/src/features/content/DocumentContent", async () => {
  const path = "../../../../frontend/node_modules/react/index.js"; const { createElement: h } = await import(path);
  return { DocumentContent: ({ interactive }: any) => interactive ? h("a", { href: "https://example.test" }, "Body link") : h("span", null, "Body preview") };
});
const expo = "../../../../frontend";
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { EntryContent } = await import(`${expo}/src/features/content/EntryContent.tsx`);
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; });
const audio = { type: "audio", attrs: { audioAssetId: 12 } };
const entry = { format: "mixed_media", format_data: {}, content: { type: "doc", content: [audio, { type: "paragraph", content: [{ type: "text", text: "Body" }] }] } };
async function render(props: Record<string, unknown>) {
  const container = document.createElement("div"); root = createRoot(container);
  await act(async () => root!.render(createElement(EntryContent, { entry, ...props })));
  return container;
}
it("keeps media-opening and entry-opening previews free of nested controls", async () => {
  const openMedia = vi.fn(), openEntry = vi.fn();
  const container = await render({ onMediaOpen: openMedia, onOpen: openEntry });
  expect(container.querySelector("button button, button a")).toBeNull();
  expect(container.textContent).toContain("Audio preview");
  await act(async () => (container.querySelector('[aria-label="Open audio 1"]') as HTMLButtonElement).click());
  expect(openMedia).toHaveBeenCalledExactlyOnceWith(0);
  expect(openEntry).not.toHaveBeenCalled();
});
it("retains direct playback and document links outside clickable previews", async () => {
  const container = await render({});
  expect(container.textContent).toContain("Play audio");
  expect(container.querySelector("a")?.textContent).toBe("Body link");
});
it("does not use a parent entry's media indexes for an attached feedback recording", async () => {
  const openMedia = vi.fn();
  const container = await render({ entry: { ...entry, content: { type: "doc", content: [] }, shared_feedback: [{ source_reply_id: 9, author_name: "Reviewer", content: { type: "doc", content: [audio] } }] }, onMediaOpen: openMedia });
  expect(container.querySelector('[aria-label="Open audio 1"]')).toBeNull();
  expect(container.textContent).toContain("Play audio");
});

it.each(["", "   ", "\n\t", "\u00a0\u200b"])("omits blank copy buttons for whitespace-only text %j", async (text) => {
  const container = await render({ entry: { ...entry, format_data: { title: text }, content: { type: "doc", content: [audio, { type: "paragraph", content: [{ type: "text", text }] }] } }, onOpen: vi.fn(), onMediaOpen: vi.fn() });
  expect(container.querySelectorAll("button")).toHaveLength(1);
  expect(container.querySelector('[aria-label="Open audio 1"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Body preview");
});
it.each(["mention", "file", "horizontalRule", "audioTimestamp"])("preserves meaningful non-text %s nodes", async (type) => {
  const container = await render({ entry: { ...entry, content: { type: "doc", content: [{ type: "paragraph", content: [{ type, attrs: { id: 1 } }] }] } }, onOpen: vi.fn() });
  expect(container.querySelectorAll("button")).toHaveLength(1);
});
it("does not leave an empty copy button when a media-only preview hides its text", async () => {
  const container = await render({ preview: true, previewLines: 0, onOpen: vi.fn(), onMediaOpen: vi.fn() });
  expect(container.querySelectorAll("button")).toHaveLength(1);
});
