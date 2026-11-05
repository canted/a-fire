import { describe, expect, it } from "vitest";
import { isRoundTemplateKey, roundTemplates } from "../../../../frontend/src/lib/roundTemplates";

describe("Round template registry", () => {
  it("keeps the chooser keys aligned with the production route keys", () => {
    expect(roundTemplates.map((activity) => activity.id)).toEqual(["feedback", "art_before_chorus"]);
    expect(roundTemplates.every((activity) => isRoundTemplateKey(activity.id))).toBe(true);
  });
});
