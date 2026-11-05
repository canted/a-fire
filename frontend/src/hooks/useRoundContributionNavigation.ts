import { useLocalSearchParams, useRouter } from "expo-router";

type ContributionKind = "cover" | "response" | "submission";
type ContributionMode = "choose" | "new" | "project";

/** Keep phase identity with its private draft; never infer it from a later Round phase. */
export function useRoundContributionNavigation() {
  const params = useLocalSearchParams<{ contribution?: string; entryMode?: string; contributionDraft?: string }>();
  const router = useRouter();
  const kind = ["cover", "response", "submission"].includes(params.contribution ?? "")
    ? params.contribution as ContributionKind : undefined;
  const mode: ContributionMode = params.entryMode === "new" || params.entryMode === "project" ? params.entryMode : "choose";
  const draft = params.contributionDraft && /^[1-9]\d*$/.test(params.contributionDraft) && Number.isSafeInteger(Number(params.contributionDraft)) ? params.contributionDraft : undefined;
  const clearSource = { contributionDraft: undefined, sourceRequest: undefined, sourceProject: undefined, sourceEntry: undefined, shareStarted: undefined };
  return {
    kind, mode, draft,
    setDraft(contributionDraft: string) { router.setParams({ contributionDraft }); },
    open(contribution: ContributionKind, entryMode: ContributionMode = "choose") {
      router.setParams({ ...clearSource, contribution, entryMode });
    },
    setMode(entryMode: ContributionMode) { router.setParams({ entryMode }); },
    close() { router.setParams({ ...clearSource, contribution: undefined, entryMode: undefined }); },
  };
}
