/** Canonical mention kinds; older stored documents retain their original attributes. */
export type MentionTargetType = "user" | "room" | "note" | "round";

export function normalizeMentionTargetType(value: unknown): MentionTargetType | null {
  switch (value) {
    case "user": return "user";
    case "room": case "circle": return "room";
    case "note": case "page": return "note";
    case "round": case "activity": return "round";
    default: return null;
  }
}
