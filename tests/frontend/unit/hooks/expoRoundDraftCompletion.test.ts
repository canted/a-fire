import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({ artifact: vi.fn(), publish: vi.fn() }));
vi.mock("../../../../frontend/src/lib/api", () => ({ client: {} }));
vi.mock("../../../../frontend/src/lib/api/rounds", () => ({ submitRoundArtifact: mocks.artifact }));
vi.mock("../../../../frontend/src/hooks/useProjects", () => ({}));
vi.mock("../../../../frontend/src/hooks/useEntryDraft", () => ({}));
vi.mock("../../../../frontend/src/lib/api/projectEntries", () => ({}));
const expo = "../../../../frontend";
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { useRoundDraftCompletion } = await import(`${expo}/src/hooks/useRoundContribution.ts`);
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; vi.clearAllMocks(); });
it.each(["submission", "cover", "response"] as const)("completes %s through its canonical lifecycle", async kind => {
  let action: ReturnType<typeof useRoundDraftCompletion>;
  mocks.artifact.mockResolvedValue({}); mocks.publish.mockResolvedValue({});
  function Probe() { action = useRoundDraftCompletion("5", kind, 71, mocks.publish); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe)));
  await act(async () => { await action!.trigger(); });
  if (kind === "submission") {
    expect(mocks.publish).toHaveBeenCalledOnce(); expect(mocks.artifact).not.toHaveBeenCalled();
  } else {
    expect(mocks.artifact).toHaveBeenCalledExactlyOnceWith({}, "5", { kind, entryId: 71 }); expect(mocks.publish).not.toHaveBeenCalled();
  }
});
