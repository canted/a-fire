const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi

type TiptapNode = {
  type?: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
}

type TiptapDoc = {
  type?: string
  content?: TiptapNode[]
}

export function firstExternalLinkFromContent(content: unknown, suppressedUrls: string[] = []): string | null {
  const doc = isDoc(content) ? content : null
  if (!doc?.content) return null

  const suppressed = new Set(suppressedUrls.map(normalizeUrlForComparison).filter(Boolean))
  const links: string[] = []

  const add = (value: unknown) => {
    const url = normalizedHttpUrl(value)
    if (!url || suppressed.has(normalizeUrlForComparison(url))) return
    if (!links.includes(url)) links.push(url)
  }

  const walk = (node: TiptapNode) => {
    if (node.type === "text") {
      node.marks
        ?.filter((mark) => mark.type === "link")
        .forEach((mark) => add(mark.attrs?.href))

      if (typeof node.text === "string") {
        for (const match of node.text.matchAll(URL_PATTERN)) {
          add(match[0])
        }
      }
    }

    node.content?.forEach(walk)
  }

  doc.content.forEach(walk)
  return links[0] ?? null
}

export function normalizedHttpUrl(input: unknown): string | null {
  if (typeof input !== "string") return null
  const trimmed = trimUrlCandidate(input.trim())
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    url.hash = ""
    url.username = ""
    url.password = ""
    return url.toString()
  } catch {
    return null
  }
}

function trimUrlCandidate(value: string): string {
  let candidate = value.replace(/[.,!?;:]+$/g, "")
  candidate = trimUnmatchedTrailing(candidate, "(", ")")
  candidate = trimUnmatchedTrailing(candidate, "[", "]")
  candidate = trimUnmatchedTrailing(candidate, "{", "}")
  return candidate
}

function trimUnmatchedTrailing(value: string, opening: string, closing: string): string {
  let candidate = value
  while (candidate.endsWith(closing) && countCharacter(candidate, closing) > countCharacter(candidate, opening)) {
    candidate = candidate.slice(0, -1)
  }
  return candidate
}

function countCharacter(value: string, character: string): number {
  return value.split(character).length - 1
}

function normalizeUrlForComparison(input: string): string {
  return normalizedHttpUrl(input) ?? input.trim()
}

function isDoc(value: unknown): value is TiptapDoc {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { content?: unknown }).content))
}
