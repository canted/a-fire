import { ART_BEFORE_CHORUS_MINIMUM_PARTICIPANTS } from "../../../../../types/activity-templates"
import { BadRequestException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"

export const ACTIVITY_TEMPLATE_KEYS = ["feedback", "art_before_chorus"] as const
export { ART_BEFORE_CHORUS_MINIMUM_PARTICIPANTS } from "../../../../../types/activity-templates"

export type RoundTemplateKey = (typeof ACTIVITY_TEMPLATE_KEYS)[number]

export type ArtBeforeChorusConfig = {
  responseFormat: "audio_text" | "audio" | "any"
  sketchSize: "tiny" | "small" | "open"
}

export type RoundTemplate = {
  key: RoundTemplateKey
  version: number
  name: string
  category: string
  description: string
  minimumParticipants?: number
  normalizeConfig: (input: unknown) => Prisma.InputJsonObject
}

const definitions: Record<RoundTemplateKey, RoundTemplate> = {
  feedback: {
    key: "feedback",
    version: 1,
    name: "Feedback Activity",
    category: "Critique",
    description: "Share work, then give and receive replies.",
    normalizeConfig: normalizeRoundLabels,
  },
  art_before_chorus: {
    key: "art_before_chorus",
    version: 1,
    name: "The Art Before the Chorus",
    category: "Icebreaker",
    description: "Bring cover art, then make a quick response to someone else’s image.",
    minimumParticipants: ART_BEFORE_CHORUS_MINIMUM_PARTICIPANTS,
    normalizeConfig: normalizeArtBeforeChorusConfig,
  },
}

export function activityTemplateDefinition(value: unknown): RoundTemplate {
  const key = value === undefined || value === null || value === "" ? "feedback" : String(value)
  if (!ACTIVITY_TEMPLATE_KEYS.includes(key as RoundTemplateKey)) {
    throw new BadRequestException("Unknown Activity template")
  }
  return definitions[key as RoundTemplateKey]
}

export function parseArtBeforeChorusConfig(value: unknown): ArtBeforeChorusConfig {
  const input = recordValue(value)
  return {
    responseFormat:
      input.responseFormat === "audio" || input.responseFormat === "any" ? input.responseFormat : "audio_text",
    sketchSize: input.sketchSize === "small" || input.sketchSize === "open" ? input.sketchSize : "tiny",
  }
}

function normalizeArtBeforeChorusConfig(value: unknown): Prisma.InputJsonObject {
  return { ...parseArtBeforeChorusConfig(value), ...normalizeRoundLabels(value) }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Optional host-configured action copy; only known phases and bounded plain strings survive. */
function normalizeRoundLabels(value: unknown): Prisma.InputJsonObject {
  const input = recordValue(recordValue(value).ctaLabels)
  const entries = ["join", "cover", "response", "submission"].flatMap(key => typeof input[key] === "string" && input[key].trim() ? [[key, input[key].trim().slice(0, 80)]] : [])
  return entries.length ? { ctaLabels: Object.fromEntries(entries) } : {}
}
