import type { RoomEntryContext } from "../../../../frontend/src/contracts/sharedEntry"
import type { RoomAccessKind } from "../rooms/room-access.service"
import { parseEntryFeedbackRequest, type FeedbackRequestPayload } from "../feedback-settings"
import type { EntryFormat, EntryFormatData } from "../entries/entry-formats"
import type { EntrySubjectPayload } from "../entries/entry-subjects"
import type { RoundState } from "./runtime/round-runtime.types"

export const ACTIVITY_STATUSES = ["draft", "active", "archived", "cancelled"] as const

export const ACTIVITY_ROLES = ["participant", "reviewer", "follower"] as const

export type RoundStatus = (typeof ACTIVITY_STATUSES)[number]

export type RoundRole = (typeof ACTIVITY_ROLES)[number]

export type RoundFeedbackRequestInput = Parameters<typeof parseEntryFeedbackRequest>[0]

export type RoundPhase = "upcoming" | "submission" | "feedback" | "complete"

export type RoundNotificationMilestone =
  | "submission_started"
  | "submission_deadline_soon"
  | "feedback_started"
  | "feedback_deadline_soon"
  | "round_completed"

export type RoundNotificationJob = {
  roundId: number
  milestone: RoundNotificationMilestone
  expectedAt: string
}

export type RoundInput = {
  /** Legacy request aliases; new clients send template fields. */
  activity_key?: unknown
  activityKey?: unknown
  activity_config?: unknown
  activityConfig?: unknown
  name?: unknown
  prompt?: unknown
  status?: unknown
  submit_by?: unknown
  submitBy?: unknown
  feedback_due_at?: unknown
  feedbackDueAt?: unknown
  feedback_request?: RoundFeedbackRequestInput | null
  feedbackRequest?: RoundFeedbackRequestInput | null
  reply_mode?: unknown
  replyMode?: unknown
  requested_feedback_types?: unknown
  requestedFeedbackTypes?: unknown
  idea_guidance?: unknown
  ideaGuidance?: unknown
  template_key?: unknown
  templateKey?: unknown
  template_config?: unknown
  templateConfig?: unknown
}

export type RoundParticipationInput = {
  role?: unknown
}

export type RoundSummaryPayload = {
  id: string
  roomId?: string | null
  hostId?: string
  name: string
  prompt?: string | null
  status: RoundStatus
  submitBy?: string | null
  feedbackDueAt?: string | null
  closedAt?: string | null
  templateKey: string
  templateVersion: number
  templateConfig: Record<string, unknown>
  feedbackRequest: FeedbackRequestPayload
  viewerState?: RoundViewerStatePayload
  viewerContributions?: { entryId: string; kind: "submission" | "reply" | "choice"; replyId?: string; replyCount?: number; occurredAt?: string; label?: string }[]
  viewerAccess?: { kind: RoomAccessKind; canParticipate: boolean; scope: "all" | "active_published_only" }
}

export type RoundViewerStatePayload = {
  role: RoundRole | null
  status: string | null
  canJoin: boolean
  canReview: boolean
  canFollow: boolean
  canSubmit: boolean
  submittedEntryId?: string | null
}

export type RoundParticipantPayload = {
  id: string
  userId: string
  role: RoundRole
  status: string
  joinedAt: string
  withdrawnAt?: string | null
  submittedEntryId?: string | null
  displayUsername: string
  avatarUrl?: string | null
}

export type RoundSubmissionPayload = RoomEntryContext & {
  id: string
  entryId: string
  userId: string
  displayUsername: string
  avatarUrl?: string | null
  submittedAt: string
  publishedAt?: string | null
  replyCount: number
  content: unknown
  format: EntryFormat
  formatData?: EntryFormatData
  subject?: EntrySubjectPayload | null
}

export type RoundDetailPayload = {
  viewerUserId: string
  round: RoundSummaryPayload
  phase: RoundPhase
  viewerState: RoundViewerStatePayload
  participants: RoundParticipantPayload[]
  reviewers: RoundParticipantPayload[]
  followers: RoundParticipantPayload[]
  submissions: RoundSubmissionPayload[]
  feedbackSummary: {
    submittedCount: number
    reviewedCount: number
    replyCount: number
  }
  feedbackProgress: {
    givenCount: number
    totalCount: number
  }
  viewerAccess: { kind: RoomAccessKind; canParticipate: boolean; scope: "all" | "active_published_only" }
  roundState?: RoundState
}
