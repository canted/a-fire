// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { normalizeNavigationLink, openOutsideRouter } from "../../../../frontend/src/lib/linkNavigation.web";
afterEach(() => vi.unstubAllGlobals());
it("opens external destinations in the existing tab and preserves the active internal host", async () => {
  const assign = vi.fn();
  const open = vi.fn();
  vi.stubGlobal("window", { location: { origin: "http://localhost:5173", assign }, open });
  expect(normalizeNavigationLink("http://127.0.0.1:5173/app/entries/3")).toBe("/app/entries/3");
  await openOutsideRouter("https://example.com/");
  expect(assign).toHaveBeenCalledExactlyOnceWith("https://example.com/");
  expect(open).not.toHaveBeenCalled();
});
