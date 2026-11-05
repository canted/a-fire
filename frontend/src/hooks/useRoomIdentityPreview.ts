import useSWR from "swr";
import type { HomeSnapshot } from "../lib/homeModel";
import type { RoomPayload } from "../lib/api/rooms";

/** Subscribe to existing session caches; identity previews never confer access. */
export function useRoomIdentityPreview(id: string) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const home = useSWR<HomeSnapshot>(["home", timezone], null);
  const room = useSWR<RoomPayload>(["managed-room", id], null);
  const recent = home.data?.recentRooms.find(item => String(item.id) === id);
  return {
    name: room.data?.name || recent?.name || "Room",
    avatar: room.data?.avatar_url ?? recent?.avatarUrl,
  };
}
