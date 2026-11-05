import type { MentionTarget, MentionTargetType } from "./api/mentions";

const TYPE_PRIORITY: MentionTargetType[] = ["user", "note", "round", "room"];
const TYPE_ORDER = Object.fromEntries(TYPE_PRIORITY.map((type, index) => [type, index])) as Record<
  MentionTargetType,
  number
>;

function matchesMentionTarget(target: MentionTarget, query: string) {
  if (!query.length) return true;
  const label = target.label.toLowerCase();
  const subtitle = target.subtitle?.toLowerCase() ?? "";
  return label.includes(query) || subtitle.includes(query) || target.targetType.includes(query);
}

export function filterMentionTargets(targets: MentionTarget[], query: string, limit = 8): MentionTarget[] {
  const normalized = query.trim().toLowerCase();

  const matches = targets
    .filter((target) => matchesMentionTarget(target, normalized))
    .sort((a, b) => TYPE_ORDER[a.targetType] - TYPE_ORDER[b.targetType]);

  if (normalized || matches.length <= limit) return matches.slice(0, limit);

  const selectedIds = new Set<string>();
  for (const type of TYPE_PRIORITY) {
    const firstOfType = matches.find((target) => target.targetType === type);
    if (firstOfType && selectedIds.size < limit) selectedIds.add(firstOfType.id);
  }
  for (const target of matches) {
    if (selectedIds.size >= limit) break;
    selectedIds.add(target.id);
  }

  return matches.filter((target) => selectedIds.has(target.id));
}
