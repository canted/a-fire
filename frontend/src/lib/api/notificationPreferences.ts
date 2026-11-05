import type { SessionTransport } from './transport';
export type NotificationPreferenceItem = {
  roomId: number;
  roomName: string | null;
  roomAvatarUrl?: string | null;
  notificationType: "all" | "entries" | "none";
};

type IndexResponse = {
  items: Array<{
    room_id: number;
    room_name: string | null;
    room_avatar_url?: string | null;
    notification_type: string;
  }>;
};

export type UpdatePayload = {
  roomId: number;
  notificationType: NotificationPreferenceItem["notificationType"];
};

function mapItem(item: IndexResponse["items"][number]): NotificationPreferenceItem {
  return {
    roomId: item.room_id ?? 0,
    roomName: item.room_name ?? null,
    roomAvatarUrl: item.room_avatar_url,
    notificationType: (item.notification_type as NotificationPreferenceItem["notificationType"]) ?? "all",
  };
}

type Client = Pick<SessionTransport, 'get' | 'patch'>;
export async function fetchNotificationPreferences(client: Client) {
  return (await client.get<IndexResponse>('/v2/notification-preferences')).items.map(mapItem);
}
export async function updateNotificationPreference(client: Client, payload: UpdatePayload) {
  return mapItem(await client.patch<IndexResponse['items'][number]>('/v2/notification-preferences', {
    room_id: payload.roomId, notification_type: payload.notificationType,
  }));
}
