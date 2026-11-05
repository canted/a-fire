import { useLocalSearchParams, useRouter } from "expo-router";
import { ViewportShell } from "../../components/ViewportShell";
import { useRoomRounds } from "../../hooks/useRounds";
import { useRoundResult } from "../../hooks/useRoundResult";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { RoundResultView } from "./RoundResultView";
import { tokens } from "../../styles/tokens";

/** Routed presentation of the existing completed-round collection owner. */
export function RoundHistoryScreen() {
  const { roomId, wall } = useLocalSearchParams<{ roomId: string; wall?: string }>();
  const router = useRouter();
  const navigation = useRoomNavigation();
  const room = useRoomRounds(roomId, true, false).room;
  const access = room.error ? "denied" : room.data?.access?.kind;
  const query = useRoundResult(roomId, wall, access, true);
  return <ViewportShell surface={tokens.paper}>
    <RoundResultView page roomId={roomId} query={query}
      select={id => router.setParams({ wall: id })}
      close={() => { void query.dismiss(() => navigation.ancestor(`/app/rooms/${roomId}`)); }}
      navigate={path => { void query.dismiss(() => navigation.destination(path)); }} />
  </ViewportShell>;
}
