import { roomHistoryItems, roomHistoryPageKey } from "../lib/roomHistory";
import useSWRInfinite from "swr/infinite";
import { fetchRoomHistory, type RoomHistoryPage } from "../lib/api/rounds";
import { client } from "../lib/api";

export function useRoomHistory(room: string, access?: "member" | "visitor") {
  const query = useSWRInfinite(
    (index: number, previous: RoomHistoryPage | null) =>
      roomHistoryPageKey(room, access, index, previous),
    ([, id, , cursor]: [string, string, string, string | null]) => fetchRoomHistory(client, id, cursor),
    { refreshInterval: 15000, revalidateAll: true },
  );
  return {
    query,
    // A failed authorization on any page hides the previously cached history.
    items: roomHistoryItems(query.data, Boolean(access && !query.error)),
    hasMore: Boolean(access && !query.error && query.data?.at(-1)?.nextCursor),
  };
}
