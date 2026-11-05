import { BadRequestException } from "@nestjs/common"

export const POST_FORMATS = ["mixed_media"] as const

export type EntryFormat = (typeof POST_FORMATS)[number]
export type EntryFormatData = Record<string, unknown> | null

export function parseEntryFormat(value: unknown, fallback: EntryFormat = "mixed_media"): EntryFormat {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value === "string" && POST_FORMATS.includes(value as EntryFormat)) return value as EntryFormat
  throw new BadRequestException("Unsupported post format")
}

/** All Entries use the same document format. */
export function parseEntryFormatUpdate(value: unknown, _stored: unknown): EntryFormat {
  return parseEntryFormat(value)
}

export function parseEntryFormatData(value: unknown): EntryFormatData {
  if (value === undefined || value === null) return null
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Post format data must be an object")
  }
  const data = value as Record<string, unknown>
  if (data.text_style !== undefined) {
    const style = data.text_style as Record<string, unknown> | null
    if (!style || typeof style !== "object" || !/^#[0-9a-f]{6}$/i.test(String(style.background)) || !/^#[0-9a-f]{6}$/i.test(String(style.color))) {
      throw new BadRequestException("Invalid text style colors")
    }
    return { ...data, text_style: { background: style.background, color: style.color } }
  }
  return data
}
