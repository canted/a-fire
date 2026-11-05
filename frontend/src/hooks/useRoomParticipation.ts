import useSWRInfinite from "swr/infinite";
import { fetchRoomParticipation, type RoomParticipationPage } from "../lib/api/rounds";
import { roomParticipationItems, roomParticipationPageKey } from "../lib/roomParticipation";
import { client } from "../lib/api";
import { useSession } from "./useSession";

export function useRoomParticipation(room: string, enabled: boolean) {
  const session = useSession();
  const identity = enabled && session.ready && session.signedIn ? String(session.epoch) : undefined;
  const query = useSWRInfinite(
    (index: number, previous: RoomParticipationPage | null) => roomParticipationPageKey(room, identity, index, previous),
    ([, id, , cursor]: readonly [string, string, string, string | null]) => fetchRoomParticipation(client, id, cursor),
    { refreshInterval: 15000, revalidateAll: true },
  );
  return {
    query,
    items: roomParticipationItems(query.data, Boolean(identity && !query.error)),
    hasMore: Boolean(identity && !query.error && query.data?.at(-1)?.nextCursor),
  };
}
