import { BadRequestException } from "@nestjs/common"
import { extractPlainText } from "../../../realtime/document-content"
import { parseEntryFormat, parseEntryFormatData } from "./entry-formats"

const containers = new Set(["doc", "paragraph", "heading", "text", "hardBreak", "blockquote", "bulletList", "orderedList", "listItem", "codeBlock", "horizontalRule"])

/** The document owns the Entry body and attachments; metadata owns its title. */
export function entryContentParts(content: unknown, formatInput: unknown, dataInput: unknown) {
  const format = parseEntryFormat(formatInput)
  const data = parseEntryFormatData(dataInput)
  const media = new Set<string>()
  const images: string[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return
    const value = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[]; marks?: { type?: string }[] }
    if (value.type === "image" && typeof value.attrs?.src === "string" && value.attrs.src.trim()) { media.add("image"); images.push(value.attrs.src) }
    else if (value.type === "audio" && (value.attrs?.audioAssetId || value.attrs?.src)) media.add("audio")
    else if (value.type === "video" && (value.attrs?.videoAssetId || value.attrs?.src)) media.add("video")
    else if (value.type && !containers.has(value.type) && !["image", "audio", "video"].includes(value.type)) media.add(value.type)
    if (value.marks?.some(mark => mark.type === "link")) media.add("link")
    value.content?.forEach(walk)
  }
  walk(content)
  if (data?.title != null && typeof data.title !== "string") throw new BadRequestException("Title must be text")
  const title = String(data?.title ?? "").trim()
  const body = extractPlainText(content).trim()
  return { format, data, title, body, media, images }
}

export function validateEntryPublication(content: unknown, formatInput: unknown, dataInput: unknown, additionalText?: string | null) {
  if (!content || typeof content !== "object" || Array.isArray(content) || (content as { type?: string }).type !== "doc" || !Array.isArray((content as { content?: unknown[] }).content)) throw new BadRequestException("Entry must be a document")
  const parts = entryContentParts(content, formatInput, dataInput)
  if (!parts.title && !parts.body && !parts.media.size && !additionalText?.trim()) {
    throw new BadRequestException("Add a title, text, or an attachment")
  }
  return parts
}

/** Phase restrictions apply to the whole payload, including shared copies. */
export function validateRoundEntryContent(
  activity: { template_key?: string | null; template_config?: unknown },
  origin: string | null | undefined,
  content: unknown,
  formatInput: unknown,
  dataInput: unknown,
  allowEmpty = false,
) {
  const draftParts = entryContentParts(content, formatInput, dataInput)
  if (allowEmpty && !draftParts.title && !draftParts.body && !draftParts.media.size) return draftParts
  const parts = validateEntryPublication(content, formatInput, dataInput)
  if (activity.template_key !== "art_before_chorus") return parts
  if (origin === "round_activity_cover") {
    if (!parts.media.has("image") || parts.title || parts.body || [...parts.media].some(kind => kind !== "image")) {
      throw new BadRequestException("This step accepts images only; remove titles, text, and other attachments")
    }
  } else if (origin === "round_activity_response") {
    const config = activity.template_config as { responseFormat?: unknown } | null
    const responseFormat = config?.responseFormat ?? "audio_text"
    const allowed = responseFormat === "audio" || responseFormat === "audio_text" ? ["audio"] : ["image", "audio", "video"]
    const body = parts.body
    if ([...parts.media].some(kind => !allowed.includes(kind)) || (responseFormat === "audio" && (!parts.media.has("audio") || body))) {
      throw new BadRequestException(responseFormat === "audio" ? "This step accepts audio only" : responseFormat === "audio_text" ? "This step accepts audio and text only" : "Use text, images, audio, or video for this response")
    }
  } else throw new BadRequestException("Choose a contribution from the Activity page")
  return parts
}
