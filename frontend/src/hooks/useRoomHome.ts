import useSWR from "swr";
import { client } from "../lib/api";
import { fetchRoomHome } from "../lib/api/roomHome";
import { useRoomRounds } from "./useRounds";
import { roomRoundsModel } from "../lib/roomRoundsModel";

/** Room identity owns home reads independently of legacy Board provisioning. */
export function useRoomHome(room: string, enabled = true) {
  const position = useSWR<number>(["room-home-position", room], null, { fallbackData: 0 });
  const rounds = useRoomRounds(room, enabled);
  const roomDetails = !rounds.room.error ? rounds.room.data : undefined;
  const home = useSWR(enabled && roomDetails ? ["room-home", room] : null,
    () => fetchRoomHome(client, room), { refreshInterval: 15000 });
  const participation = Boolean(roomDetails?.access?.can_participate_rounds);
  const model = roomRoundsModel(rounds.rounds.data, room, participation);
  return { ...rounds, position, home, roomData: roomDetails, participation, current: model.current };
}
