export function extractMentionedUserIds(content: unknown): number[] {
  const userIds = new Set<number>()

  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return

    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }

    const node = value as Record<string, unknown>
    if (node.type === "mention") {
      const userId = mentionUserId(node.attrs)
      if (userId) userIds.add(userId)
    }

    visit(node.content)
  }

  visit(content)
  return Array.from(userIds)
}

function mentionUserId(attrsValue: unknown): number | null {
  if (!attrsValue || typeof attrsValue !== "object") return null

  const attrs = attrsValue as Record<string, unknown>
  const targetType = stringValue(attrs.targetType)
  if (targetType && targetType !== "user") return null

  const fromTargetId = parsePositiveInteger(stringValue(attrs.targetId))
  if (targetType === "user" && fromTargetId) return fromTargetId

  const id = stringValue(attrs.id)
  if (!id?.startsWith("user:")) return null
  return parsePositiveInteger(id.slice("user:".length))
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}
