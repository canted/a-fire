import type { RoundDetail } from "./api/rounds";

export function roundAction(detail: RoundDetail): { label: string; kind: string } | null {
  if (detail.round.status !== "active" || detail.phase === "complete") return null;
  const labels = detail.round.templateConfig?.ctaLabels as Record<string, unknown> | undefined;
  const label = (key: string, fallback: string) => typeof labels?.[key] === "string" && labels[key].trim() ? labels[key].trim() : fallback;
  const viewer = detail.viewerState;
  if (viewer.role !== "participant" || viewer.status !== "active") return { kind: "join", label: viewer.canJoin ? label("join", "Join the round") : "View round" };
  const state = detail.roundState;
  if (state?.phase === "collecting_covers") return state.viewer.cover ? { kind: "waiting", label: "Image pinned up" } : { kind: "cover", label: label("cover", "Pin up an image") };
  if (state?.phase === "collecting_responses") {
    if (state.viewer.response) return { kind: "waiting", label: "Response pinned up" };
    if (!state.viewer.cover) return { kind: "waiting", label: "View round" };
    if (!state.viewer.chosenCover) return { kind: "choose", label: "Choose an image" };
    return { kind: "response", label: label("response", "Pin up a musical response") };
  }
  if (viewer.submittedEntryId) return { kind: "feedback", label: detail.phase === "feedback" ? "Give feedback" : "Shared" };
  return viewer.canSubmit ? { kind: "submission", label: label("submission", "Share something") } : { kind: "waiting", label: "View round" };
}
