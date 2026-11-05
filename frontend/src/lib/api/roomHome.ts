import type { SessionTransport } from "./transport";
import type { EntryPreview } from "./roomEntryPreviews";
export type RoomHome = {
  roomId: string;
  members: Array<{ membershipId: string; userId: string; username: string; avatarUrl?: string | null; latestEntry?: EntryPreview | null; recentEntries?: EntryPreview[] }>;
  /** Remove with the remaining legacy publication allocation dependency. */
  viewer_access: { kind: "member" | "visitor"; can_write: boolean; can_reply: boolean; entry_history: "all" | "current_only" };
};
export function fetchRoomHome(client: Pick<SessionTransport, "get">, roomId: string): Promise<RoomHome> {
  return client.get<RoomHome>(`/v1/rooms/${roomId}/home`);
}
