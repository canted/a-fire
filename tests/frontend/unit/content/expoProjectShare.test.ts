import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const state = vi.hoisted(() => ({ publish: vi.fn(), open: vi.fn(), prepared: false, revision: "v1", extra: false }));
const paragraph = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const manifest = { revision: "v1", units: [
  { id: "title", kind: "title", title: "Source title", eligible: true, content: paragraph("Source title") },
  { id: "body", kind: "body", eligible: true, content: paragraph("Source body") },
  { id: "feedback:9", kind: "feedback", authorName: "Maya", eligible: false, unavailableReason: "different-room", content: paragraph("Other Room") },
] };
vi.mock("../../../../frontend/src/hooks/useProjectShare", () => ({ useProjectShare: () => ({
  memberships: { data: { memberships: [{ room: { id: 7, name: "Studio" } }] } },
  rounds: {}, room: {}, manifest: { data: { ...manifest, revision: state.revision, units: [...manifest.units, ...(state.extra ? [{ id: "media:new", kind: "media", eligible: true, content: paragraph("New media") }] : [])] } },
}) }));
vi.mock("../../../../frontend/src/hooks/useRoomEntryPublication", () => ({ useRoomEntryPublication: () => ({ publish: state.publish, prepared: state.prepared }) }));
vi.mock("../../../../frontend/src/hooks/useContentLink", () => ({ useContentLink: () => ({ open: state.open }) }));
vi.mock("../../../../frontend/src/components/RoomIcon", () => ({ RoomIcon: () => null }));
vi.mock("../../../../frontend/src/components/Icon", () => ({ Icon: () => null }));
vi.mock("../../../../frontend/src/features/content/EntryContent", () => ({ EntryContent: ({ renderMediaOverlay }: { renderMediaOverlay?: (index: number) => unknown }) => renderMediaOverlay?.(0) ?? null }));
vi.mock("../../../../frontend/node_modules/react-native", async () => {
  const path = "../../../../frontend/node_modules/react/index.js";
  const { createElement: h } = await import(path);
  return { StyleSheet: { create: (value: unknown) => value }, ActivityIndicator: () => null,
    Text: ({ children }: { children: unknown }) => h("span", null, children), View: ({ children }: { children: unknown }) => h("div", null, children) };
});
vi.mock("../../../../frontend/src/components/Button", async () => {
  const path = "../../../../frontend/node_modules/react/index.js";
  const { createElement: h } = await import(path);
  return { Button: ({ children, onPress, disabled, checked, accessibilityLabel }: Record<string, unknown>) => h("button", { onClick: onPress, disabled, "aria-label": accessibilityLabel, "aria-checked": checked }, children) };
});
vi.mock("../../../../frontend/src/components/PopupMenu", async () => {
  const path = "../../../../frontend/node_modules/react/index.js";
  const { createElement: h } = await import(path);
  return { PopupMenu: ({ children, footer }: Record<string, unknown>) => h("div", null, children, footer) };
});
vi.mock("../../../../frontend/src/components/Select", () => ({ Select: () => null }));
vi.mock("../../../../frontend/src/components/Input", async () => {
  const path = "../../../../frontend/node_modules/react/index.js";
  const { createElement: h } = await import(path);
  return { Input: ({ value, onChangeText }: { value: string; onChangeText: (value: string) => void }) => h("textarea", { value, onChange: (event: { target: { value: string } }) => onChangeText(event.target.value) }) };
});
const expo = "../../../../frontend";
const { act, createElement: h } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { ProjectShare } = await import(`${expo}/src/features/projects/ProjectShare.tsx`);
let root: Root | undefined;
let container: HTMLDivElement;
const close = vi.fn();
async function mount() {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(h(ProjectShare, { projectId: "1", entry: { id: 2 } as never, initialRoom: "7", onClose: close })));
}
function button(text: string) { return [...container.querySelectorAll("button")].find(item => item.textContent === text)!; }
beforeEach(() => { state.prepared = false; state.revision = "v1"; state.extra = false; state.publish.mockResolvedValue({ entryId: 3, path: "/app/entries/3" }); state.open.mockResolvedValue(undefined); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); container?.remove(); vi.clearAllMocks(); });
it("starts with eligible units selected and keeps different-Room feedback excluded", async () => {
  await mount();
  expect(container.querySelector('[aria-label="Title"]')?.getAttribute("aria-checked")).toBe("true");
  expect(container.querySelector('[aria-label="Body"]')?.getAttribute("aria-checked")).toBe("true");
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Feedback from Maya, unavailable in this Room"]')?.disabled).toBe(true);
  expect(container.textContent).toContain("only be shared to its original Room");
  expect(container.textContent).toContain("Feedback from Maya");
});
it("publishes only selected source identifiers and returns to Room home", async () => {
  await mount();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Title"]')!.click());
  await act(async () => button("Share in Studio").click());
  expect(state.publish).toHaveBeenCalledExactlyOnceWith({ room_id: 7, source_revision: "v1", selected_unit_ids: ["body"], room_statement: "" });
  expect(state.open).toHaveBeenCalledWith("/app/rooms/7");
  expect(close).toHaveBeenCalledOnce();
});
it("requires source content rather than allowing an empty selection", async () => {
  await mount();
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Title"]')!.click(); });
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Body"]')!.click(); });
  expect(button("Share in Studio").disabled).toBe(true);
  expect(state.publish).not.toHaveBeenCalled();
});
it("locks selection when a copy has already been prepared for a publication retry", async () => {
  state.prepared = true;
  await mount();
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Title"]')?.disabled).toBe(true);
  expect(button("Retry sharing").disabled).toBe(false);
});
it("requires review after a source refresh and preserves exclusions without selecting new parts", async () => {
  await mount();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Title"]')!.click());
  state.revision = "v2";
  state.extra = true;
  await act(async () => root!.render(h(ProjectShare, { projectId: "1", entry: { id: 2 } as never, initialRoom: "7", onClose: close })));
  expect(button("Share in Studio").disabled).toBe(true);
  expect(container.textContent).toContain("The original changed");
  expect(container.querySelector('[aria-label="Include media 1"]')).toBeNull();
  await act(async () => button("Review updated source").click());
  expect(container.querySelector('[aria-label="Title"]')?.getAttribute("aria-checked")).toBe("false");
  expect(container.querySelector('[aria-label="Include media 1"]')?.getAttribute("aria-checked")).toBe("false");
  await act(async () => button("Share in Studio").click());
  expect(state.publish).toHaveBeenCalledExactlyOnceWith({ room_id: 7, source_revision: "v2", selected_unit_ids: ["body"], room_statement: "" });
});

it("offers a direct room-named action from the read-only picker preview", async () => {
  await mount();
  await act(async () => root!.render(h(ProjectShare, { projectId: "1", entry: { id: 2 } as never, initialRoom: "7", preview: true, onClose: close })));
  expect(container.querySelector('[aria-label="Title"]')).toBeNull();
  expect(container.querySelector('textarea')).toBeNull();
  await act(async () => button("Share in Studio").click());
  expect(state.publish).toHaveBeenCalledExactlyOnceWith({ room_id: 7, source_revision: "v1", selected_unit_ids: ["title", "body"], room_statement: "" });
});
