import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("../../../../frontend/src/lib/api", () => ({ client: {} }));
vi.mock("../../../../frontend/src/lib/api/linkPreviews", () => ({ resolveLinkPreview: mocks.resolve }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const expo = "../../../../frontend";
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { SWRConfig } = await import(`${expo}/node_modules/swr/dist/index/index.mjs`);
const { useLinkPreview } = await import(`${expo}/src/hooks/useLinkPreview.ts`);
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; vi.resetAllMocks(); });
it("never resolves private Project or entry URLs and clears an earlier public preview", async () => {
  mocks.resolve.mockResolvedValue({ title: "Public art reference", url: "https://example.com/art" });
  let result: ReturnType<typeof useLinkPreview>;
  const cache = new Map();
  function Probe({ url }: { url: string }) { result = useLinkPreview(url); void result.data; return null; }
  root = createRoot(document.createElement("div"));
  async function render(url: string) {
    await act(async () => root!.render(createElement(SWRConfig, { value: { provider: () => cache, shouldRetryOnError: false } }, createElement(Probe, { url }))));
  }
  await render("https://example.com/art");
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith({}, "https://example.com/art");
  expect(result!.data).toMatchObject({ title: "Public art reference" });
  for (const url of [
    "https://a-fire.example/app/projects/12",
    "https://a-fire.example/app/projects/12/entries/41?view=detail",
    "https://a-fire.example/app/entries/41#reply-9",
  ]) {
    await render(url);
    expect(result!.data).toBeUndefined();
    expect(result!.isLoading).toBe(false);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
  }
});
