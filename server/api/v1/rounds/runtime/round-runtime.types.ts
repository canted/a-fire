import type { RoomEntryContext } from "../../../../../frontend/src/contracts/sharedEntry"
import type { EntryFormat, EntryFormatData } from "../../entries/entry-formats"

export type RoundPhase = "upcoming" | "collecting_covers" | "collecting_responses" | "complete"

export type RoundCoverPayload = {
  id: string
  entryId: string
  imageUrl: string
  alt: string
  contributorName?: string
}

export type RoundResponsePayload = RoomEntryContext & {
  id: string
  entryId: string
  creatorName: string
  avatarUrl?: string | null
  format: EntryFormat
  formatData?: EntryFormatData
  content: unknown
  coverId: string
}

export type ArtBeforeChorusRoundState = {
  key: "art_before_chorus"
  phase: RoundPhase
  isHost: boolean
  config: {
    responseFormat: "audio_text" | "audio" | "any"
    sketchSize: "tiny" | "small" | "open"
  }
  coverProgress: {
    submitted: number
    minimum: number
    remaining: number
    waitingPastSchedule: boolean
  }
  participants: Array<{
    id: string
    userId: string
    name: string
    avatarUrl?: string | null
    hasCover: boolean
    cover?: RoundCoverPayload
    responseStatus?: "choosing" | "making" | "submitted"
  }>
  viewer: {
    cover?: RoundCoverPayload
    offeredCovers?: [RoundCoverPayload, RoundCoverPayload]
    chosenCover?: RoundCoverPayload
    response?: RoundResponsePayload
  }
  results: Array<{
    cover: RoundCoverPayload
    response: RoundResponsePayload
  }>
}

export type RoundState = ArtBeforeChorusRoundState

export type RoundArtifactInput = {
  kind?: unknown
  entryId?: unknown
  entry_id?: unknown
}

export type RoundChoiceInput = {
  coverId?: unknown
  cover_id?: unknown
}

export type RoundRemovalInput = {
  artifactId?: unknown
  artifact_id?: unknown
  note?: unknown
  sendPushNotification?: unknown
  send_push_notification?: unknown
}
