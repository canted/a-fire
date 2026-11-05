import { expect, it } from "vitest";
import { roundAction } from "../../../../frontend/src/lib/roundAction";
import type { RoundDetail, ArtBeforeChorusRoundState } from "../../../../frontend/src/lib/api/rounds";
const detail = (input: Partial<RoundDetail> = {}) => ({ round: { id: "1", status: "active", templateConfig: {} }, phase: "submission", viewerState: { role: "participant", status: "active", canSubmit: true }, ...input } as RoundDetail);
const state = (phase: ArtBeforeChorusRoundState["phase"], viewer = {}) => ({ phase, viewer } as ArtBeforeChorusRoundState);
it("uses a join action before participation and no action after completion", () => {
  expect(roundAction(detail({ viewerState: { role: null, status: null, canJoin: true } as RoundDetail["viewerState"] }))?.label).toBe("Join the round");
  expect(roundAction(detail({ phase: "complete" }))).toBeNull();
});
it("distinguishes making, choosing, and already-submitted phases", () => {
  expect(roundAction(detail({ roundState: state("collecting_covers") }))?.label).toBe("Pin up an image");
  expect(roundAction(detail({ roundState: state("collecting_covers", { cover: {} }) }))?.kind).toBe("waiting");
  expect(roundAction(detail({ roundState: state("collecting_responses", { cover: {} }) }))?.label).toBe("Choose an image");
  expect(roundAction(detail({ roundState: state("collecting_responses", { cover: {}, chosenCover: {} }) }))?.label).toBe("Pin up a musical response");
  expect(roundAction(detail({ roundState: state("collecting_responses", { cover: {}, chosenCover: {}, response: {} }) }))?.kind).toBe("waiting");
});
it("honors configured CTA text and falls back for blank or invalid configuration", () => {
  const value = detail(); value.round.templateConfig = { ctaLabels: { submission: "Pin up your small sound" } };
  expect(roundAction(value)?.label).toBe("Pin up your small sound");
  value.round.templateConfig = { ctaLabels: { submission: " " } };
  expect(roundAction(value)?.label).toBe("Share something");
});
