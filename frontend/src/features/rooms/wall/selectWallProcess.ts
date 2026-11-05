import type { ComponentProps } from "react";
import type { EntryContent } from "../../content/EntryContent";

export type WallFeedback = {
  id: string;
  entryId: string;
  author: string;
  text: string;
  savedAt: string;
  sourceTitle: string;
};
export type WallProcessEntry = {
  id: string;
  project: string;
  date: string;
  dateLabel: string;
  statement?: string;
  replyCount?: number;
  replyParticipants?: Array<{ id: number; username: string; avatar_url?: string | null }>;
  replies?: Array<{
    id: number;
    username: string;
    avatar_url?: string | null;
    text: string;
  }>;
  entry: ComponentProps<typeof EntryContent>["entry"];
  /** Already artist-selected references; never infer these from dates or project proximity. */
  touchstones?: WallFeedback[];
  /** Only responses saved to the project by this artist, associated with this exact entry. */
  savedResponses?: WallFeedback[];
};
export type WallProcessSlot =
  | { kind: "entry"; entry: WallProcessEntry }
  | { kind: "statement"; entry: WallProcessEntry; text: string }
  | {
      kind: "feedback";
      entry: WallProcessEntry;
      feedback: WallFeedback;
      relation: "before" | "after";
    };

/** Shared Room presentation policy; only explicit associations occupy context slots.
 * Latest entry first for allocation; entry groups then display oldest to newest.
 * Production currently supplies entries and saved subsequent feedback only.
 */
export function selectWallProcess(
  entries: WallProcessEntry[],
  budget = 3,
): WallProcessSlot[] {
  let remaining = Math.max(0, Math.floor(budget));
  const groups: WallProcessSlot[][] = [];
  const seen = new Set<string>();
  for (const entry of [...entries].sort(
    (a, b) => Date.parse(b.date) - Date.parse(a.date),
  )) {
    if (!remaining) break;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const slots: WallProcessSlot[] = [{ kind: "entry", entry }];
    remaining--;
    if (remaining && entry.statement?.trim()) {
      slots.unshift({ kind: "statement", entry, text: entry.statement });
      remaining--;
    }
    const response = [...(entry.savedResponses ?? [])]
      .filter((item) => item.entryId === entry.id)
      .sort((a, b) => Date.parse(a.savedAt) - Date.parse(b.savedAt))[0];
    if (remaining && response) {
      slots.push({
        kind: "feedback",
        entry,
        feedback: response,
        relation: "after",
      });
      remaining--;
    }
    const before = entry.touchstones?.[0];
    if (remaining && before) {
      slots.unshift({
        kind: "feedback",
        entry,
        feedback: before,
        relation: "before",
      });
      remaining--;
    }
    groups.unshift(slots);
  }
  return groups.flat();
}
