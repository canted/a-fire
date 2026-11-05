export function contentSourceLabel(attrs: { label?: string | null; sourceType?: string | null; authorName?: string | null }) {
  if (attrs.label?.trim()) return attrs.label;
  if (attrs.sourceType === "Audio") return "Audio";

  const itemType = attrs.sourceType === "Reply" ? "reply" : "post";
  if (attrs.authorName?.trim()) return `${attrs.authorName}'s ${itemType}`;
  return `From a ${itemType}`;
}
