import type { Prisma } from "@prisma/client"

/** Canonical document for chat display, conversion and retained project snapshots. */
export function chatMessageDocument(body: string, content?: Prisma.JsonValue | null) {
  if (content && typeof content === "object" && !Array.isArray(content) && content.type === "doc" && Array.isArray(content.content)) return content
  return { type: "doc", content: [{ type: "paragraph", content: body ? [{ type: "text", text: body }] : [] }] }
}

/** Attachments, rather than text/mentions/links, acquire a canonical Entry. */
export function hasChatAttachment(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  if (Array.isArray(value)) return value.some(hasChatAttachment)
  const node = value as { type?: string; content?: unknown }
  return ["image", "audio", "video", "file"].includes(node.type ?? "") || hasChatAttachment(node.content)
}
