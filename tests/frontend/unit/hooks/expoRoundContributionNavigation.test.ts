import { afterEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
const state = vi.hoisted(() => ({ params: {} as Record<string, string | undefined>, setParams: vi.fn() }));
vi.mock("../../../../frontend/node_modules/expo-router", () => ({
  useLocalSearchParams: () => state.params,
  useRouter: () => ({ setParams: state.setParams }),
}));
const expo = "../../../../frontend";
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import("react");
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import("react-dom/client");
const { useRoundContributionNavigation } = await import(`${expo}/src/hooks/useRoundContributionNavigation.ts`);
let root: Root | undefined;
let navigation: ReturnType<typeof useRoundContributionNavigation>;
function Probe() { navigation = useRoundContributionNavigation(); return null; }
async function mount(params: typeof state.params) {
  state.params = params;
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe)));
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.clearAllMocks(); });
it.each(["cover", "response", "submission"])("restores the exact %s phase and creation mode on a cold mount", async kind => {
  await mount({ contribution: kind, entryMode: "new", sourceProject: "12", sourceEntry: "41", sourceRequest: "stable-source-request" });
  expect(navigation).toMatchObject({ kind, mode: "new" });
  expect(state.setParams).not.toHaveBeenCalled();
});
it("clears completed draft identity before another contribution can begin", async () => {
  await mount({ contribution: "cover", entryMode: "new", sourceEntry: "41" });
  navigation.close();
  expect(state.setParams).toHaveBeenLastCalledWith({ contribution: undefined, contributionDraft: undefined, entryMode: undefined, sourceRequest: undefined, sourceProject: undefined, sourceEntry: undefined, shareStarted: undefined });
  navigation.open("response");
  expect(state.setParams).toHaveBeenLastCalledWith({ contribution: "response", contributionDraft: undefined, entryMode: "choose", sourceRequest: undefined, sourceProject: undefined, sourceEntry: undefined, shareStarted: undefined });
});
it("records selection mode without discarding the current private source", async () => {
  await mount({ contribution: "submission", entryMode: "choose" });
  navigation.setMode("new");
  expect(state.setParams).toHaveBeenLastCalledWith({ entryMode: "new" });
});
it("does not interpret an unknown phase as a valid contribution", async () => {
  await mount({ contribution: "later", entryMode: "unknown" });
  expect(navigation).toMatchObject({ kind: undefined, mode: "choose" });
});

it("reopens the same prepared Round copy after a cold mount", async () => {
  await mount({ contribution: "submission", entryMode: "project", contributionDraft: "71" });
  expect(navigation.draft).toBe("71");
  navigation.setDraft("72");
  expect(state.setParams).toHaveBeenLastCalledWith({ contributionDraft: "72" });
});
it.each(["0", "-1", "71junk", "9007199254740992"])("rejects invalid prepared draft identity %s", async contributionDraft => {
  await mount({ contributionDraft });
  expect(navigation.draft).toBeUndefined();
});
