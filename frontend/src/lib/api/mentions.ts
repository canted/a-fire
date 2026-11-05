import type { SessionTransport } from "./transport";

import type { MentionTargetType } from "../../../../types/mention-target";
export type { MentionTargetType } from "../../../../types/mention-target";

export type MentionTarget = {
  id: string;
  targetType: MentionTargetType;
  targetId: string;
  label: string;
  subtitle: string | null;
  avatarUrl: string | null;
  icon: string | null;
  href: string | null;
};

export type MentionTargetsPayload = {
  roomId: number;
  targets: MentionTarget[];
};

type MentionTargetResponse = {
  id: string;
  target_type: MentionTargetType;
  target_id: string;
  label: string;
  subtitle: string | null;
  avatar_url: string | null;
  icon: string | null;
  href: string | null;
};

type MentionTargetsResponse = {
  room_id: number;
  targets: MentionTargetResponse[];
};

function normalizeMentionTarget(target: MentionTargetResponse): MentionTarget {
  return {
    id: target.id,
    targetType: target.target_type,
    targetId: target.target_id,
    label: target.label,
    subtitle: target.subtitle,
    avatarUrl: target.avatar_url,
    icon: target.icon,
    href: target.href,
  };
}

export async function fetchMentionTargets(
  client: Pick<SessionTransport, "get">,
  contextRoomId: string | number,
): Promise<MentionTargetsPayload> {
  const response = await client.get<MentionTargetsResponse>(
    `/v1/mentions?room_id=${encodeURIComponent(String(contextRoomId))}`,
  );

  return {
    roomId: response.room_id,
    targets: response.targets.map(normalizeMentionTarget),
  };
}
