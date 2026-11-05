import type { Prisma } from "@prisma/client"

const POST_SUBJECT_TYPES = new Set(["plain_text", "note", "page", "audio_asset", "video_asset", "image", "link"])

export type EntrySubjectType = "plain_text" | "note" | "page" | "audio_asset" | "video_asset" | "image" | "link"
export type EntrySubjectMode = "auto" | "manual" | "none"

export type EntrySubjectPayload = {
  type: EntrySubjectType
  id?: string | number | null
  key?: string | null
  sourceNodeId?: string | null
  label?: string | null
  preview?: Prisma.JsonObject | null
  mode?: EntrySubjectMode
}

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

type StoredEntrySubject = {
  subject_type: string
  subject_id?: number | null
  subject_key?: string | null
  source_node_id?: string | null
  metadata?: unknown
}

export function normalizeEntrySubjectPayload(input: unknown, content: unknown): EntrySubjectPayload {
  const normalized = normalizeEntrySubjectInput(input)
  return normalized ?? deriveEntrySubject(content)
}

export function deriveEntrySubject(content: unknown): EntrySubjectPayload {
  const doc = isDoc(content) ? content : null
  const candidates = collectSubjectCandidates(doc)
  return candidates[0] ?? plainTextSubject(doc)
}

export function serializeStoredEntrySubject(subject?: StoredEntrySubject | null): EntrySubjectPayload | null {
  if (!subject || !POST_SUBJECT_TYPES.has(subject.subject_type)) return null
  const subjectType = subject.subject_type === "page" ? "note" : subject.subject_type
  const metadata = isRecord(subject.metadata) ? subject.metadata : {}
  return {
    type: subjectType as EntrySubjectType,
    id: subject.subject_id ?? null,
    key: subject.subject_key ?? null,
    sourceNodeId: subject.source_node_id ?? null,
    label: stringAttr(metadata.label) ?? null,
    preview: isJsonObject(metadata.preview) ? metadata.preview : null,
    mode: postSubjectMode(metadata.mode),
  }
}

export function postSubjectPersistenceData(subject: EntrySubjectPayload) {
  const subjectType = subject.type === "page" ? "note" : POST_SUBJECT_TYPES.has(subject.type) ? subject.type : "plain_text"
  return {
    subject_type: subjectType,
    subject_id: integerId(subject.id),
    subject_key: stringAttr(subject.key) ?? null,
    source_node_id: stringAttr(subject.sourceNodeId) ?? null,
    metadata: {
      label: stringAttr(subject.label) ?? null,
      preview: isJsonObject(subject.preview) ? subject.preview : null,
      mode: postSubjectMode(subject.mode),
    },
  }
}

function normalizeEntrySubjectInput(input: unknown): EntrySubjectPayload | null {
  if (!isRecord(input)) return null
  const type = stringAttr(input.type)
  if (!type || !POST_SUBJECT_TYPES.has(type)) return null
  const subjectType = type === "page" ? "note" : type
  return {
    type: subjectType as EntrySubjectType,
    id: idAttr(input.id),
    key: stringAttr(input.key),
    sourceNodeId: stringAttr(input.sourceNodeId),
    label: stringAttr(input.label),
    preview: isJsonObject(input.preview) ? input.preview : null,
    mode: postSubjectMode(input.mode),
  }
}

function collectSubjectCandidates(doc: TiptapDoc | null): EntrySubjectPayload[] {
  if (!doc?.content) return []
  const candidates: EntrySubjectPayload[] = []
  const seen = new Set<string>()

  const addCandidate = (candidate: EntrySubjectPayload) => {
    const identity = subjectIdentity(candidate)
    if (seen.has(identity)) return
    seen.add(identity)
    candidates.push({ ...candidate, mode: "auto" })
  }

  const walk = (node: TiptapNode) => {
    const attrs = node.attrs ?? {}
    const sourceNodeId = stringAttr(attrs.nodeId)

    if (node.type === "pageLink" || node.type === "noteLink") {
      const id = idAttr(attrs.noteId ?? attrs.pageId)
      if (id) {
        addCandidate({
          type: "note",
          id,
          key: `note:${id}`,
          sourceNodeId,
          label: stringAttr(attrs.title) ?? stringAttr(attrs.label) ?? "Page",
          preview: { noteId: id, pageId: id },
        })
      }
    }

    if (node.type === "audio") {
      const id = idAttr(attrs.audioAssetId)
      if (id) {
        addCandidate({
          type: "audio_asset",
          id,
          key: `audio_asset:${id}`,
          sourceNodeId,
          label: stringAttr(attrs.title) ?? "Audio",
          preview: { title: stringAttr(attrs.title), status: stringAttr(attrs.status) },
        })
      }
    }

    if (node.type === "video") {
      const id = idAttr(attrs.videoAssetId)
      if (id) {
        addCandidate({
          type: "video_asset",
          id,
          key: `video_asset:${id}`,
          sourceNodeId,
          label: stringAttr(attrs.title) ?? "Video",
          preview: { title: stringAttr(attrs.title), status: stringAttr(attrs.status), thumbnailUrl: stringAttr(attrs.thumbnailUrl) },
        })
      }
    }

    if (node.type === "image") {
      const src = stringAttr(attrs.src)
      if (src) {
        addCandidate({
          type: "image",
          key: src,
          sourceNodeId,
          label: stringAttr(attrs.alt) ?? stringAttr(attrs.title) ?? "Image",
          preview: { src, alt: stringAttr(attrs.alt), title: stringAttr(attrs.title) },
        })
      }
    }

    node.content?.forEach(walk)
  }

  doc.content.forEach(walk)
  return candidates
}

function plainTextSubject(doc: TiptapDoc | null): EntrySubjectPayload {
  const text = plainText(doc).trim()
  return {
    type: "plain_text",
    key: text ? text.slice(0, 120) : null,
    label: text ? text.slice(0, 80) : "Text post",
    preview: text ? { text } : null,
    mode: "auto",
  }
}

function plainText(doc: TiptapDoc | null): string {
  if (!doc?.content) return ""
  const parts: string[] = []
  const walk = (node: TiptapNode) => {
    if (node.type === "text" && typeof node.text === "string") {
      parts.push(node.text)
      return
    }
    node.content?.forEach(walk)
  }
  doc.content.forEach(walk)
  return parts.join(" ").replace(/\s+/g, " ").trim()
}

function subjectIdentity(subject: EntrySubjectPayload): string {
  return `${subject.type}:${String(subject.id ?? subject.key ?? subject.sourceNodeId ?? subject.label ?? "")}`
}

function isDoc(value: unknown): value is TiptapDoc {
  return isRecord(value) && Array.isArray(value.content)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isJsonObject(value: unknown): value is Prisma.JsonObject {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null) && Object.values(value).every(isJsonValue)
}

function isJsonValue(value: unknown): value is Prisma.JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isJsonObject(value)
}

function stringAttr(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function idAttr(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function integerId(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : null
  if (!parsed || !Number.isInteger(parsed)) return null
  return parsed
}

function postSubjectMode(value: unknown): EntrySubjectMode {
  return value === "manual" || value === "none" ? value : "auto"
}
