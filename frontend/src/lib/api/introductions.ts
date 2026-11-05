import type { SessionTransport } from "./transport";
type ApiClient = Pick<SessionTransport, "get" | "post" | "patch" | "delete" | "put">;

export type IntroductionParticipant = {
  id: string;
  displayUsername: string;
  avatarUrl?: string | null;
};

export type IntroductionSummary = {
  id: string;
  note: string;
  createdAt: string;
  entryId?: string | null;
  throughPost: boolean;
  viewerIsRecipient: boolean;
  viewerSeenAt?: string | null;
  canHide: boolean;
  canRetract: boolean;
  createdBy: IntroductionParticipant;
  participants: IntroductionParticipant[];
  otherUser: IntroductionParticipant;
};

export type IntroductionOverview = {
  count: number;
  unseenCount: number;
  authors: IntroductionParticipant[];
  remainingAuthorCount: number;
  unseenIntroductions: IntroductionSummary[];
};

export type MemberIntroductionsResponse = {
  id: string;
  userId?: string | null;
  viewerUserId: string;
  username: string;
  displayUsername: string;
  profileLine?: string | null;
  avatarUrl?: string | null;
  displayAvatarUrl?: string | null;
  isCurrentUser: boolean;
  roomId?: string | null;
  roomName?: string | null;
  introductions: IntroductionSummary[];
  nextCursor?: string | null;
};

export type CreateIntroductionPayload = {
  room_id: string | number;
  recipient_user_ids: Array<string | number>;
  note: string;
  entry_id?: string | number | null;
};

export type CreateIntroductionResponse = {
  introduction: {
    id: string;
  };
  existing?: boolean;
};

export type RoomIntroductionPairsResponse = {
  pairs: Array<{
    introduction_id: string;
    recipient_user_ids: [number, number];
  }>;
};

export async function createIntroduction(
  client: ApiClient,
  payload: CreateIntroductionPayload,
): Promise<CreateIntroductionResponse> {
  return client.post<CreateIntroductionResponse>("/v1/introductions", payload);
}

export async function fetchRoomIntroductionPairs(
  client: ApiClient,
  roomId: string | number,
): Promise<RoomIntroductionPairsResponse> {
  return client.get<RoomIntroductionPairsResponse>(
    `/v1/introductions/rooms/${roomId}/pairs`,
  );
}

export async function hideIntroduction(client: ApiClient, introductionId: string | number): Promise<{ success: true }> {
  return client.post<{ success: true }>(`/v1/introductions/${introductionId}/hide`, {});
}

export async function retractIntroduction(client: ApiClient, introductionId: string | number): Promise<{ success: true }> {
  return client.post<{ success: true }>(`/v1/introductions/${introductionId}/retract`, {});
}

export async function markIntroductionsSeen(
  client: ApiClient,
  introductionIds: Array<string | number>,
): Promise<{ success: true; markedCount: number }> {
  return client.post<{ success: true; markedCount: number }>("/v1/introductions/seen", {
    introduction_ids: introductionIds,
  });
}


export function fetchRoomMemberIntroductions(client: Pick<SessionTransport, 'get'>, roomId: string, memberUserId: string, page: { cursor?: string; target?: string } = {}) {
  return client.get<MemberIntroductionsResponse>(`/v1/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(memberUserId)}/introductions${introductionPageQuery(page)}`);
}

function introductionPageQuery(page: { cursor?: string; target?: string }) {
  const query = new URLSearchParams();
  if (page.cursor) query.set('cursor', page.cursor);
  if (page.target) query.set('introduction', page.target);
  return query.size ? `?${query}` : '';
}
