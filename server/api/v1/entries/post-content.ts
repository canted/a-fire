import { normalizePrivateUploadUrls } from "../uploads/upload-urls"

export const DEFAULT_TIPTAP_DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [] }],
}

export function chatSourceDocument(body: string, content: unknown) {
  if (
    content &&
    typeof content === "object" &&
    !Array.isArray(content) &&
    (content as { type?: unknown }).type === "doc" &&
    Array.isArray((content as { content?: unknown }).content)
  ) {
    return content
  }
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: body ? [{ type: "text", text: body }] : [],
      },
    ],
  }
}

export function conversionDocument(sourceContent: unknown, submittedContent: unknown) {
  const sourceNodes =
    sourceContent &&
    typeof sourceContent === "object" &&
    !Array.isArray(sourceContent) &&
    Array.isArray((sourceContent as { content?: unknown }).content)
      ? ((sourceContent as { content: unknown[] }).content ?? [])
      : []
  const submittedNodes =
    submittedContent &&
    typeof submittedContent === "object" &&
    !Array.isArray(submittedContent) &&
    Array.isArray((submittedContent as { content?: unknown }).content)
      ? ((submittedContent as { content: unknown[] }).content ?? [])
      : []
  const mediaNodes = submittedNodes.filter((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return false
    return ["image", "audio", "video"].includes(String((node as { type?: unknown }).type))
  })
  return { type: "doc", content: [...sourceNodes, ...mediaNodes] }
}

export function truncateText(value: string, length: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= length) return normalized
  return `${normalized.slice(0, Math.max(0, length - 1)).trimEnd()}…`
}

/** Document is the sole Entry body, including an intentionally empty document. */
export function entryBody(documentContent: unknown): unknown {
  return documentContent ?? DEFAULT_TIPTAP_DOC
}

export function parseContent(raw?: string | null): unknown | null {
  if (!raw) return null
  try {
    return normalizeUploadUrls(JSON.parse(raw))
  } catch {
    return null
  }
}

export function normalizeUploadUrls(content: unknown): unknown {
  return normalizePrivateUploadUrls(content).value
}

export function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}
