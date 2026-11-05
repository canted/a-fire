import type { RoomEntryContext } from "../../contracts/sharedEntry";
import type { SessionTransport } from "./transport";
type ApiClient = Pick<SessionTransport, "get" | "post" | "put" | "patch" | "delete">;
import { normalizeFeedbackRequest, type FeedbackRequest } from "../feedback";
import type { TiptapDoc } from "../tiptap";
import type { EntryFormat, EntryFormatData } from "../../contracts/entryFormats";
import type { EntrySubjectPayload } from "../../contracts/entrySubjects";

export type RoundRole = "participant" | "reviewer" | "follower";
export type RoundStatus = "draft" | "active" | "archived" | "cancelled";
export type RoundTemplateKey = "feedback" | "art_before_chorus";

export type RoundViewerState = {
  role: RoundRole | null;
  status: string | null;
  canJoin: boolean;
  canReview: boolean;
  canFollow: boolean;
  canSubmit: boolean;
  submittedEntryId?: string | null;
};

export type ParticipationIdentity = { id: number; username: string; display_username: string; display_avatar_url: string | null; avatar_url: string | null };
export type ParticipationPreview = {
  entry: RoomEntryContext & { id: number; content: TiptapDoc; format: EntryFormat; format_data: EntryFormatData | null; user: ParticipationIdentity };
  replies: { id: number; content: TiptapDoc; user: ParticipationIdentity | null }[];
  participants: ParticipationIdentity[];
};

export type RoundSummary = {
  cover?: { imageUrl: string; alt: string } | null;
  id: string;
  roomId?: string | null;
  hostId: string;
  name: string;
  prompt?: string | null;
  status: RoundStatus;
  submitBy?: string | null;
  feedbackDueAt?: string | null;
  closedAt?: string | null;
  templateKey?: RoundTemplateKey;
  templateVersion?: number;
  templateConfig?: Record<string, unknown>;
  feedbackRequest: FeedbackRequest;
  viewerState?: RoundViewerState;
  viewerContributions?: { preview?: ParticipationPreview | null; entryId: string; kind: "submission" | "reply" | "choice"; replyId?: string; replyCount?: number; occurredAt?: string; label?: string }[];
};

export type RoundParticipant = {
  id: string;
  userId: string;
  role: RoundRole;
  status: string;
  joinedAt: string;
  withdrawnAt?: string | null;
  submittedEntryId?: string | null;
  displayUsername: string;
  avatarUrl?: string | null;
};

export type RoundSubmission = RoomEntryContext & {
  id: string;
  entryId: string;
  userId: string;
  displayUsername: string;
  avatarUrl?: string | null;
  submittedAt: string;
  publishedAt?: string | null;
  replyCount: number;
  content: TiptapDoc;
  format: EntryFormat;
  formatData?: EntryFormatData | null;
  subject?: EntrySubjectPayload | null;
};

export type RoomRoundsResponse = {
  roomId?: string;
  viewerAccess?: { kind: "member" | "visitor"; canParticipate: boolean; scope: "all" | "active_published_only" };
  participationPreview?: RoomParticipationPage["items"];
  currentRounds?: RoundSummary[];
  roomHistory?: { id: string; label: string; occurredAt: string; roundId?: string; cover?: RoundSummary["cover"] }[];
  activeRound: RoundSummary | null;
  nextRound: RoundSummary | null;
  recentRounds: RoundSummary[];
};

export type RoundDetail = {
  /** Optional while older API instances are being replaced. */
  viewerUserId?: string;
  round: RoundSummary;
  phase: "upcoming" | "submission" | "feedback" | "complete";
  viewerState: RoundViewerState;
  participants: RoundParticipant[];
  reviewers: RoundParticipant[];
  followers: RoundParticipant[];
  submissions: RoundSubmission[];
  feedbackSummary: {
    submittedCount: number;
    reviewedCount: number;
    replyCount: number;
  };
  feedbackProgress: {
    givenCount: number;
    totalCount: number;
  };
  roundState?: ArtBeforeChorusRoundState;
};

export type RoundCover = {
  id: string;
  entryId: string;
  imageUrl: string;
  alt: string;
  contributorName?: string;
};

export type RoundResponse = RoomEntryContext & {
  id: string;
  entryId: string;
  creatorName: string;
  avatarUrl?: string | null;
  format: EntryFormat;
  formatData?: EntryFormatData | null;
  content: TiptapDoc;
  coverId: string;
};

export type ArtBeforeChorusRoundState = {
  key: "art_before_chorus";
  phase: "upcoming" | "collecting_covers" | "collecting_responses" | "complete";
  isHost: boolean;
  config: {
    responseFormat: "audio_text" | "audio" | "any";
    sketchSize: "tiny" | "small" | "open";
  };
  coverProgress: {
    submitted: number;
    minimum: number;
    remaining: number;
    waitingPastSchedule: boolean;
  };
  participants: Array<{
    id: string;
    userId: string;
    name: string;
    avatarUrl?: string | null;
    hasCover: boolean;
    cover?: RoundCover;
    responseStatus?: "choosing" | "making" | "submitted";
  }>;
  viewer: {
    cover?: RoundCover;
    offeredCovers?: [RoundCover, RoundCover];
    chosenCover?: RoundCover;
    response?: RoundResponse;
  };
  results: Array<{ cover: RoundCover; response: RoundResponse }>;
};

export type RoundReminderResult = {
  sent: number;
  phase: "submission" | "feedback";
};

export type RoundPayload = {
  name?: string;
  prompt?: string;
  status?: RoundStatus;
  submitBy?: string | null;
  feedbackDueAt?: string | null;
  feedbackRequest?: FeedbackRequest | null;
  templateKey?: RoundTemplateKey;
  templateConfig?: Record<string, unknown>;
};

export type RoomParticipationPage = {
  items: {
    id: string;
    round: Pick<RoundSummary, "id" | "name" | "cover">;
    contribution: NonNullable<RoundSummary["viewerContributions"]>[number];
  }[];
  nextCursor: string | null;
};

export function fetchRoomParticipation(client: ApiClient, roomId: string, cursor: string | null = null): Promise<RoomParticipationPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return client.get<RoomParticipationPage>(`/v1/rooms/${encodeURIComponent(roomId)}/participation${query}`);
}

export type RoomHistoryPage = {
  items: NonNullable<RoomRoundsResponse["roomHistory"]>;
  nextCursor: string | null;
};

export function fetchRoomHistory(client: ApiClient, roomId: string, cursor: string | null = null): Promise<RoomHistoryPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return client.get<RoomHistoryPage>(`/v1/rooms/${encodeURIComponent(roomId)}/history${query}`);
}

export async function fetchRoomRounds(client: ApiClient, roomId: string | number): Promise<RoomRoundsResponse> {
  return normalizeRoundList(await client.get<RoomRoundsResponse>(`/v1/rooms/${roomId}/rounds/overview`));
}

function normalizeRoundList(payload: RoomRoundsResponse): RoomRoundsResponse {
  return {
    ...payload,
    currentRounds: payload.currentRounds?.map(normalizeRound).filter(Boolean) as RoundSummary[] | undefined,
    activeRound: normalizeRound(payload.activeRound),
    nextRound: normalizeRound(payload.nextRound),
    recentRounds: payload.recentRounds.map(normalizeRound).filter(Boolean) as RoundSummary[],
  };
}

export async function createRoomRound(client: ApiClient, roomId: string, payload: RoundPayload): Promise<RoundSummary> {
  return normalizeRound(await client.post<RoundSummary>(`/v1/rooms/${roomId}/rounds`, serializeRoundPayload(payload)))!;
}

export async function updateRound(client: ApiClient, activityId: string | number, payload: RoundPayload): Promise<RoundSummary> {
  return normalizeRound(await client.patch<RoundSummary>(`/v1/rounds/${activityId}`, serializeRoundPayload(payload)))!;
}

export async function startRound(client: ApiClient, activityId: string | number): Promise<RoundSummary> {
  return normalizeRound(await client.post<RoundSummary>(`/v1/rounds/${activityId}/start`))!;
}

export async function archiveRound(client: ApiClient, activityId: string | number): Promise<RoundSummary> {
  return normalizeRound(await client.post<RoundSummary>(`/v1/rounds/${activityId}/archive`))!;
}

export async function fetchRound(client: ApiClient, activityId: string | number): Promise<RoundDetail> {
  const detail = await client.get<RoundDetail>(`/v1/rounds/${activityId}`);
  return {
    ...detail,
    round: normalizeRound(detail.round)!,
  };
}

export async function updateRoundParticipation(
  client: ApiClient,
  activityId: string | number,
  role: RoundRole,
): Promise<RoundDetail> {
  return fetchNormalizedDetail(client.post<RoundDetail>(`/v1/rounds/${activityId}/participation`, { role }));
}

export async function withdrawRoundParticipation(client: ApiClient, activityId: string | number): Promise<RoundDetail> {
  return fetchNormalizedDetail(client.delete<RoundDetail>(`/v1/rounds/${activityId}/participation`));
}

export async function remindForCurrentRoundPhase(
  client: ApiClient,
  activityId: string | number,
): Promise<RoundReminderResult> {
  return client.post<RoundReminderResult>(`/v1/rounds/${activityId}/reminders/phase`);
}

export async function remindRoundParticipantToSubmit(
  client: ApiClient,
  activityId: string | number,
  targetUserId: string | number,
): Promise<RoundReminderResult> {
  return client.post<RoundReminderResult>(`/v1/rounds/${activityId}/reminders/submission/${targetUserId}`);
}

export async function submitRoundArtifact(
  client: ApiClient,
  activityId: string | number,
  input: { kind: "cover" | "response"; entryId: string | number },
) {
  return client.post<{ id: string; kind: string; submittedAt: string }>(`/v1/rounds/${activityId}/contributions/artifacts`, input);
}

export async function chooseRoundCover(
  client: ApiClient,
  activityId: string | number,
  coverId: string | number,
) {
  return client.post<{ chosenCoverId: string }>(`/v1/rounds/${activityId}/contributions/choice`, { coverId });
}

export async function removeRoundArtifact(
  client: ApiClient,
  activityId: string | number,
  artifactId: string | number,
  input: { note: string; sendPushNotification: boolean },
) {
  return client.delete<{ removed: true; notificationStatus: string }>(
    `/v1/rounds/${activityId}/contributions/artifacts/${artifactId}`,
    { body: input },
  );
}

async function fetchNormalizedDetail(promise: Promise<RoundDetail>) {
  const detail = await promise;
  return {
    ...detail,
    round: normalizeRound(detail.round)!,
  };
}

function serializeRoundPayload(payload: RoundPayload) {
  return {
    name: payload.name,
    prompt: payload.prompt,
    status: payload.status,
    submitBy: payload.submitBy,
    feedbackDueAt: payload.feedbackDueAt,
    feedbackRequest: payload.feedbackRequest,
    templateKey: payload.templateKey,
    templateConfig: payload.templateConfig,
  };
}

export function normalizeRound(activity: RoundSummary | null | undefined): RoundSummary | null {
  if (!activity) return null;
  return {
    ...activity,
    templateKey: activity.templateKey ?? "feedback",
    templateVersion: activity.templateVersion ?? 1,
    templateConfig: activity.templateConfig ?? {},
    feedbackRequest: normalizeFeedbackRequest(activity.feedbackRequest),
  };
}
