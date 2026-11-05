import { ART_BEFORE_CHORUS_MINIMUM_PARTICIPANTS } from "../../../types/activity-templates";
export type RoundTemplateChoice = {
  id: "feedback" | "art_before_chorus";
  name: string;
  category: string;
  description: string;
  minimumParticipants?: number;
  iconSequence: readonly ["imageSquare", "waveform" | "chatTeardrop"];
  cardColors: readonly ["purple" | "aqua", "orange" | "yellow"];
};
import type { RoundTemplateKey } from "./api/rounds";

export const artBeforeChorusTemplate = {
  id: "art_before_chorus",
  name: "The Art Before the Chorus",
  category: "Icebreaker",
  description: "Everyone contributes cover art, chooses from two images, and makes a small musical response.",
  minimumParticipants: ART_BEFORE_CHORUS_MINIMUM_PARTICIPANTS,
  iconSequence: ["imageSquare", "waveform"],
  cardColors: ["purple", "orange"],
} satisfies RoundTemplateChoice;

export const roundTemplates: RoundTemplateChoice[] = [
  {
    id: "feedback",
    name: "Feedback Round",
    category: "Critique",
    description: "Everyone shares one piece, then gives feedback in an open conversation.",
    iconSequence: ["imageSquare", "chatTeardrop"],
    cardColors: ["aqua", "yellow"],
  },
  artBeforeChorusTemplate,
];

export function isRoundTemplateKey(value: string | undefined): value is RoundTemplateKey {
  return value === "feedback" || value === "art_before_chorus";
}
