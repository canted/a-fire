export const REPLY_MODES = ["simple", "guided"] as const;
export const FEEDBACK_TYPES = ["impression", "question", "idea"] as const;
export const IDEA_GUIDANCE_VALUES = ["open", "craft", "concept", "readiness", "constraint", "professional"] as const;

export type ReplyMode = (typeof REPLY_MODES)[number];
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export type IdeaGuidance = (typeof IDEA_GUIDANCE_VALUES)[number];

export type FeedbackRequest = {
  reply_mode: ReplyMode;
  requested_feedback_types: FeedbackType[];
  idea_guidance: IdeaGuidance | null;
};

export type RoomReplySettings = {
  replyMode: ReplyMode;
  defaultFeedbackTypes: FeedbackType[];
  defaultIdeaGuidance: IdeaGuidance;
  canEditReplyMode?: boolean;
};

export const DEFAULT_FEEDBACK_TYPES: FeedbackType[] = ["impression", "question", "idea"];
export const DEFAULT_IDEA_GUIDANCE: IdeaGuidance = "open";

export function normalizeFeedbackRequest(value?: Partial<FeedbackRequest> | null): FeedbackRequest {
  const replyMode: ReplyMode = value?.reply_mode === "guided" ? "guided" : "simple";
  const requested = Array.isArray(value?.requested_feedback_types)
    ? value.requested_feedback_types.filter((type): type is FeedbackType => FEEDBACK_TYPES.includes(type as FeedbackType))
    : DEFAULT_FEEDBACK_TYPES;

  return {
    reply_mode: replyMode,
    requested_feedback_types: replyMode === "guided" && requested.length > 0 ? Array.from(new Set(requested)) : [],
    idea_guidance:
      replyMode === "guided" && IDEA_GUIDANCE_VALUES.includes(value?.idea_guidance as IdeaGuidance)
        ? (value?.idea_guidance as IdeaGuidance)
        : replyMode === "guided"
          ? DEFAULT_IDEA_GUIDANCE
          : null,
  };
}

export function normalizeRoomReplySettings(value?: Partial<RoomReplySettings> | null): RoomReplySettings {
  const replyMode: ReplyMode = value?.replyMode === "guided" ? "guided" : "simple";
  const defaultFeedbackTypes = Array.isArray(value?.defaultFeedbackTypes)
    ? value.defaultFeedbackTypes.filter((type): type is FeedbackType => FEEDBACK_TYPES.includes(type as FeedbackType))
    : DEFAULT_FEEDBACK_TYPES;

  return {
    replyMode,
    defaultFeedbackTypes: defaultFeedbackTypes.length > 0 ? Array.from(new Set(defaultFeedbackTypes)) : DEFAULT_FEEDBACK_TYPES,
    defaultIdeaGuidance: IDEA_GUIDANCE_VALUES.includes(value?.defaultIdeaGuidance as IdeaGuidance)
      ? (value?.defaultIdeaGuidance as IdeaGuidance)
      : DEFAULT_IDEA_GUIDANCE,
    canEditReplyMode: value?.canEditReplyMode,
  };
}

export function defaultFeedbackType(
  requestedTypes: FeedbackType[],
  preferredType?: FeedbackType | null,
): FeedbackType | null {
  if (preferredType && requestedTypes.includes(preferredType)) return preferredType;
  if (requestedTypes.includes("impression")) return "impression";
  if (requestedTypes.includes("question")) return "question";
  if (requestedTypes.includes("idea")) return "idea";
  return requestedTypes[0] ?? null;
}
