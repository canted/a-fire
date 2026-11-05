export function extractPlainText(content: unknown): string {
  if (!content || typeof content !== "object") return ""
  const nodes = (content as { content?: unknown }).content
  if (!Array.isArray(nodes)) return ""
  return nodes.map((node) => flattenText(node as Record<string, unknown>)).join(" ").trim()
}

function flattenText(node: Record<string, unknown>): string {
  const text = typeof node.text === "string" ? node.text : ""
  const children = Array.isArray(node.content) ? (node.content as Array<Record<string, unknown>>) : []
  return [text, ...children.map((child) => flattenText(child))].join(" ").trim()
}

export function trimTrailingBlankNodes(content: unknown): unknown {
  if (!content || typeof content !== "object") return content
  const nodes = (content as { content?: unknown }).content
  if (!Array.isArray(nodes)) return content
  const trimmed = [...nodes]
  while (trimmed.length > 0 && isBlankNode(trimmed[trimmed.length - 1] as Record<string, unknown>)) {
    trimmed.pop()
  }
  if (trimmed.length === nodes.length) return content
  return { ...(content as Record<string, unknown>), content: trimmed }
}

function isBlankNode(node: Record<string, unknown>): boolean {
  const nodeType = typeof node.type === "string" ? node.type : ""
  const text = typeof node.text === "string" ? node.text.trim() : ""
  const children = Array.isArray(node.content) ? (node.content as Array<Record<string, unknown>>) : []
  if (nodeType === "text") return text.length === 0
  if (text.length > 0) return false
  const attrs = typeof node.attrs === "object" && node.attrs !== null ? (node.attrs as Record<string, unknown>) : null
  if (attrs && Object.keys(attrs).length > 0) return false
  if (children.length === 0) return true
  return children.every((child) => isBlankNode(child))
}
