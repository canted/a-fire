import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const state = vi.hoisted(() => ({ navigate: vi.fn(), selected: "" }));
const project = { id: 1, name: "Sketches", viewer_participation: "owner" };
const entry = { id: 2, kind: "material", can_share: true };
vi.mock("../../../../frontend/src/hooks/useHome", () => ({ useHome: () => ({ data: { recentEntries: [{ project, entry }, { project, entry: { ...entry, id: 3, draft: true } }, { project, entry: { ...entry, id: 4, can_share: false } }] } }) }));
vi.mock("../../../../frontend/src/hooks/useProjects", () => ({ useProjects: () => ({ data: { projects: [project] } }), useProject: (id: string) => { state.selected = id; return { data: id ? project : undefined }; } }));
vi.mock("../../../../frontend/src/hooks/useProjectTimeline", () => ({ useProjectTimeline: () => ({ query: {}, entries: [entry], hasMore: false }) }));
vi.mock("../../../../frontend/src/hooks/useRoomNavigation", () => ({ useRoomNavigation: () => ({ destination: state.navigate }) }));
vi.mock("../../../../frontend/src/components/Icon", () => ({ Icon: () => null }));
vi.mock("../../../../frontend/src/features/projects/ProjectIcon", () => ({ ProjectIcon: () => null }));
vi.mock("../../../../frontend/node_modules/react-native", async () => {
  const { createElement: h } = await import(String("../../../../frontend/node_modules/react/index.js")) as typeof import('react');
  return { StyleSheet: { create: (value: unknown) => value }, ActivityIndicator: () => null, Text: ({ children }: any) => h("span", null, children), View: ({ children }: any) => { for (const child of [children].flat()) { if (typeof child === "string" || typeof child === "number") throw new Error("Unexpected text node in View"); } return h("div", null, children); } };
});
vi.mock("../../../../frontend/src/components/Button", async () => {
  const { createElement: h } = await import(String("../../../../frontend/node_modules/react/index.js")) as typeof import('react');
  return { Button: ({ children, onPress }: any) => h("button", { onClick: onPress }, children) };
});
vi.mock("../../../../frontend/src/components/PopupMenu", async () => {
  const { createElement: h } = await import(String("../../../../frontend/node_modules/react/index.js")) as typeof import('react');
  return { PopupMenu: ({ children, title }: any) => h("section", { "aria-label": title }, children) };
});
vi.mock("../../../../frontend/src/features/home/HomeProjectTiles", async () => {
  const { createElement: h } = await import(String("../../../../frontend/node_modules/react/index.js")) as typeof import('react');
  return { HomeProjectTiles: ({ entries, onOpenEntry, data }: any) => h("div", { "data-activity": Boolean(data) }, entries.map((item: any) => h("button", { key: item.entry.id, onClick: () => onOpenEntry(item) }, `Tile ${item.entry.id}`))) };
});
const { act, createElement: h } = await import(String("../../../../frontend/node_modules/react/index.js")) as typeof import("react");
const { createRoot } = await import(String("../../../../frontend/node_modules/react-dom/client.js")) as typeof import("react-dom/client");
const { ProjectSharePicker } = await import("../../../../frontend/src/features/projects/ProjectSharePicker");
let root: Root;
afterEach(async () => { await act(async () => root?.unmount()); vi.clearAllMocks(); });
it("browses eligible recent tiles and projects through the canonical share preview route", async () => {
  const host = document.createElement("div"); root = createRoot(host);
  const close = vi.fn();
  await act(async () => root.render(h(ProjectSharePicker, { room: "7", roomName: "Studio", onClose: close, create: vi.fn() })));
  expect(host.querySelector("section")?.getAttribute("aria-label")).toBe("Share in Studio");
  expect(host.textContent).not.toContain("Recent entries");
  expect(host.textContent!.indexOf("Projects")).toBeLessThan(host.textContent!.indexOf("Tile 2"));
  expect(host.textContent).toContain("Tile 2");
  expect(host.textContent).not.toContain("Tile 3");
  expect(host.textContent).not.toContain("Tile 4");
  expect(host.textContent).not.toContain("Choose an entry");
  const click = (label: string) => act(async () => { [...host.querySelectorAll("button")].find(button => button.textContent === label)!.click(); });
  await click("Sketches");
  expect(state.selected).toBe("1");
  await click("All projects");
  expect(state.selected).toBeUndefined();
  await click("Tile 2");
  expect(close).toHaveBeenCalledOnce();
  expect(state.navigate).toHaveBeenCalledWith("/app/projects/1/entries/2/share?room=7&preview=1");
});
