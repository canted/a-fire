import {
  DEFAULT_FEEDBACK_TYPES,
  DEFAULT_IDEA_GUIDANCE,
  type FeedbackType,
  type IdeaGuidance,
} from "./feedback";

type FeedbackTypeCopy = {
  label: string;
  pluralLabel: string;
  toolbarLabel: string;
  actionLabel: string;
  description: string;
  composerPrompt: string;
  helper: string;
};

type IdeaGuidanceCopy = {
  label: string;
  prompt: string;
};

export const FEEDBACK_TYPE_COPY = {
  impression: {
    label: "Impression",
    pluralLabel: "Impressions",
    toolbarLabel: "Impression",
    actionLabel: "Share an impression",
    description: "Share what you noticed, felt, remembered, or kept returning to in the work.",
    composerPrompt: "How did this land for you?",
    helper: "Share reception, not fixes.",
  },
  question: {
    label: "Question",
    pluralLabel: "Questions",
    toolbarLabel: "Question",
    actionLabel: "Ask a question",
    description: "Ask about intent, process, choices, references, or what feels unresolved.",
    composerPrompt: "What choice or intention would you like to understand?",
    helper: "Ask it openly. Don't hide advice in the question.",
  },
  idea: {
    label: "Idea",
    pluralLabel: "Ideas",
    toolbarLabel: "Idea",
    actionLabel: "Offer an idea",
    description: "Offer one possible direction, experiment, constraint, or next move in your own voice.",
    composerPrompt: "What direction do you see?",
    helper: "Use first-person language. Offer one idea at a time.",
  },
} satisfies Record<FeedbackType, FeedbackTypeCopy>;

export const IDEA_GUIDANCE_COPY = {
  open: {
    label: "Any useful idea",
    prompt: "What direction do you see?",
  },
  craft: {
    label: "Make the work stronger",
    prompt: "What would make this stronger?",
  },
  concept: {
    label: "Clarify the meaning",
    prompt: "What idea or meaning could be clearer?",
  },
  readiness: {
    label: "Get it ready to share",
    prompt: "What would help this feel ready to share?",
  },
  constraint: {
    label: "Try a constraint",
    prompt: "What constraint might open it up?",
  },
  professional: {
    label: "Prepare for an opportunity",
    prompt: "What would help this meet an opportunity?",
  },
} satisfies Record<IdeaGuidance, IdeaGuidanceCopy>;

export function feedbackTypeLabel(type: FeedbackType) {
  return FEEDBACK_TYPE_COPY[type].label;
}

export function feedbackTypePluralLabel(type: FeedbackType) {
  return FEEDBACK_TYPE_COPY[type].pluralLabel;
}

export function feedbackTypeToolbarLabel(type: FeedbackType) {
  return FEEDBACK_TYPE_COPY[type].toolbarLabel;
}

export function feedbackTypeActionLabel(type: FeedbackType) {
  return FEEDBACK_TYPE_COPY[type].actionLabel;
}

export function feedbackTypeDescription(type: FeedbackType) {
  return FEEDBACK_TYPE_COPY[type].description;
}

export function feedbackComposerPrompt(type: FeedbackType, ideaGuidance?: IdeaGuidance | null) {
  if (type === "idea") return ideaGuidancePrompt(ideaGuidance ?? DEFAULT_IDEA_GUIDANCE);
  return FEEDBACK_TYPE_COPY[type].composerPrompt;
}

export function feedbackComposerHelper(type: FeedbackType) {
  return FEEDBACK_TYPE_COPY[type].helper;
}

export function ideaGuidanceLabel(value: IdeaGuidance) {
  return IDEA_GUIDANCE_COPY[value].label;
}

export function ideaGuidancePrompt(value: IdeaGuidance) {
  return IDEA_GUIDANCE_COPY[value].prompt;
}

export function feedbackTypeListLabel(types: FeedbackType[]) {
  if (types.length === 0) return "Simple replies";
  if (DEFAULT_FEEDBACK_TYPES.every((type) => types.includes(type))) return "Any feedback is okay";
  return types.map(feedbackTypePluralLabel).join(", ");
}

export function quotedIdeaGuidancePrompt(value: IdeaGuidance) {
  return `"${ideaGuidancePrompt(value)}"`;
}
