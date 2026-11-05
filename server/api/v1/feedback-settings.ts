import { BadRequestException } from "@nestjs/common"

export const REPLY_MODES = ["simple", "guided"] as const
export const FEEDBACK_TYPES = ["impression", "question", "idea"] as const
export const IDEA_GUIDANCE_VALUES = ["open", "craft", "concept", "readiness", "constraint", "professional"] as const

export type ReplyMode = (typeof REPLY_MODES)[number]
export type FeedbackType = (typeof FEEDBACK_TYPES)[number]
export type IdeaGuidance = (typeof IDEA_GUIDANCE_VALUES)[number]

export const DEFAULT_REPLY_MODE: ReplyMode = "simple"
export const DEFAULT_FEEDBACK_TYPES: FeedbackType[] = ["impression", "question", "idea"]
export const DEFAULT_IDEA_GUIDANCE: IdeaGuidance = "open"

export type FeedbackRequestPayload = {
  reply_mode: ReplyMode
  requested_feedback_types: FeedbackType[]
  idea_guidance: IdeaGuidance | null
}

export type RoomReplySettingsPayload = {
  replyMode: ReplyMode
  defaultFeedbackTypes: FeedbackType[]
  defaultIdeaGuidance: IdeaGuidance
  canEditReplyMode?: boolean
}

export function normalizeReplyMode(value: unknown, fallback: ReplyMode = DEFAULT_REPLY_MODE): ReplyMode {
  return REPLY_MODES.includes(value as ReplyMode) ? (value as ReplyMode) : fallback
}

export function normalizeFeedbackTypes(value: unknown, fallback: FeedbackType[] = DEFAULT_FEEDBACK_TYPES): FeedbackType[] {
  if (!Array.isArray(value)) return [...fallback]

  const normalized: FeedbackType[] = []
  value.forEach((item) => {
    if (!FEEDBACK_TYPES.includes(item as FeedbackType)) return
    if (normalized.includes(item as FeedbackType)) return
    normalized.push(item as FeedbackType)
  })

  return normalized
}

export function normalizeIdeaGuidance(value: unknown, fallback: IdeaGuidance = DEFAULT_IDEA_GUIDANCE): IdeaGuidance {
  return IDEA_GUIDANCE_VALUES.includes(value as IdeaGuidance) ? (value as IdeaGuidance) : fallback
}

export function validateGuidedFeedbackTypes(replyMode: ReplyMode, feedbackTypes: FeedbackType[]) {
  if (replyMode === "guided" && feedbackTypes.length === 0) {
    throw new BadRequestException("Guided feedback needs at least one feedback type")
  }
}

export function parseBoardReplySettings(input: {
  reply_mode?: unknown
  replyMode?: unknown
  default_feedback_types?: unknown
  defaultFeedbackTypes?: unknown
  default_idea_guidance?: unknown
  defaultIdeaGuidance?: unknown
}) {
  const replyMode = normalizeReplyMode(input.reply_mode ?? input.replyMode)
  const defaultFeedbackTypes = normalizeFeedbackTypes(input.default_feedback_types ?? input.defaultFeedbackTypes)
  const defaultIdeaGuidance = normalizeIdeaGuidance(input.default_idea_guidance ?? input.defaultIdeaGuidance)
  validateGuidedFeedbackTypes(replyMode, defaultFeedbackTypes)
  return { replyMode, defaultFeedbackTypes, defaultIdeaGuidance }
}

export function parseEntryFeedbackRequest(input: {
  reply_mode?: unknown
  replyMode?: unknown
  requested_feedback_types?: unknown
  requestedFeedbackTypes?: unknown
  idea_guidance?: unknown
  ideaGuidance?: unknown
}) {
  const replyMode = normalizeReplyMode(input.reply_mode ?? input.replyMode)
  const requestedFeedbackTypes =
    replyMode === "guided"
      ? normalizeFeedbackTypes(input.requested_feedback_types ?? input.requestedFeedbackTypes)
      : []
  const ideaGuidance = replyMode === "guided" ? normalizeIdeaGuidance(input.idea_guidance ?? input.ideaGuidance) : null
  validateGuidedFeedbackTypes(replyMode, requestedFeedbackTypes)
  return { replyMode, requestedFeedbackTypes, ideaGuidance }
}

export function serializeRoomFeedbackSettings(
  settings: {
    reply_mode?: string | null
    default_feedback_types?: unknown
    default_idea_guidance?: string | null
  },
  options: { canEditReplyMode?: boolean } = {},
): RoomReplySettingsPayload {
  return {
    replyMode: normalizeReplyMode(settings.reply_mode),
    defaultFeedbackTypes: normalizeFeedbackTypes(settings.default_feedback_types),
    defaultIdeaGuidance: normalizeIdeaGuidance(settings.default_idea_guidance),
    canEditReplyMode: options.canEditReplyMode,
  }
}

export function serializeEntryFeedbackRequest(post: {
  reply_mode?: string | null
  requested_feedback_types?: unknown
  idea_guidance?: string | null
}): FeedbackRequestPayload {
  const replyMode = normalizeReplyMode(post.reply_mode)
  return {
    reply_mode: replyMode,
    requested_feedback_types: replyMode === "guided" ? normalizeFeedbackTypes(post.requested_feedback_types) : [],
    idea_guidance: replyMode === "guided" ? normalizeIdeaGuidance(post.idea_guidance) : null,
  }
}

export function normalizeReplyFeedbackType(value: unknown): FeedbackType | null {
  return FEEDBACK_TYPES.includes(value as FeedbackType) ? (value as FeedbackType) : null
}

/** Interpret stored defaults through the same validation as an explicit request. */
export function feedbackRequestFromDefaults(defaults?: {
  reply_mode?: unknown
  default_feedback_types?: unknown
  default_idea_guidance?: unknown
} | null) {
  return parseEntryFeedbackRequest({
    reply_mode: defaults?.reply_mode,
    requested_feedback_types: defaults?.default_feedback_types,
    idea_guidance: defaults?.default_idea_guidance,
  })
}
