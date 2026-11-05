import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({ pick: vi.fn(), release: vi.fn(), validate: vi.fn() }));
vi.mock("../../../../frontend/src/lib/chatFiles", () => ({ pickChatFile: mocks.pick, releaseChatFile: mocks.release }));
vi.mock("../../../../frontend/src/lib/imageFile", () => ({ assertImageFile: mocks.validate }));
const expo = "../../../../frontend";
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { useImageSelection } = await import(`${expo}/src/hooks/useImageSelection.ts`);
let selection: ReturnType<typeof useImageSelection>;
let root: Root | undefined;
let container: HTMLDivElement;
async function mount() {
  container = document.createElement("div");
  root = createRoot(container);
  function Harness() { selection = useImageSelection(); return null; }
  await act(async () => root!.render(createElement(Harness)));
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; vi.clearAllMocks(); });
it("releases replaced previews and the final preview on unmount", async () => {
  await mount();
  const first = { uri: "blob:first" }, second = { uri: "blob:second" };
  mocks.pick.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  await act(async () => { await selection.choose(); });
  await act(async () => { await selection.choose(); });
  expect(selection.image).toBe(second);
  expect(mocks.release).toHaveBeenCalledWith(first);
  await act(async () => root!.unmount()); root = undefined;
  expect(mocks.release).toHaveBeenCalledWith(second);
});
it("disposes a picker result arriving after unmount", async () => {
  await mount();
  let resolve!: (value: unknown) => void;
  mocks.pick.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = selection.choose();
  await act(async () => root!.unmount()); root = undefined;
  const abandoned = { uri: "blob:abandoned" };
  await act(async () => { resolve(abandoned); await pending; });
  expect(mocks.release).toHaveBeenCalledWith(abandoned);
});
it("clearing an image also invalidates a pending picker", async () => {
  await mount();
  let resolve!: (value: unknown) => void;
  mocks.pick.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = selection.choose();
  await act(async () => selection.clear());
  const abandoned = { uri: "blob:cleared" };
  await act(async () => { resolve(abandoned); await pending; });
  expect(selection.image).toBeUndefined();
  expect(mocks.release).toHaveBeenCalledWith(abandoned);
});
