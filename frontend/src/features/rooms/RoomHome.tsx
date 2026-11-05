import { RoomLoading } from "./RoomLoading";
import { useRef, type Ref } from "react";
import { type ScrollView, ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { PageScrollView } from "../../components/PageScrollView";
import { Button } from "../../components/Button";
import { RoomWall } from "./RoomWall";
import { roomWallMembers } from "./wall/wallModel";
import { CurrentRound } from "../rounds/RoomRoundsScreen";
import type { useRoomHome } from "../../hooks/useRoomHome";
import type { WallProcessEntry } from "./wall/selectWallProcess";
import { layout } from "../../styles/layout";

const reportActions = () => {};
export function RoomRoundContext({ query, compact = false }: { query: ReturnType<typeof useRoomHome>; compact?: boolean }) {
  const failedQuery = query.room.error ? query.room : query.rounds.error ? query.rounds : undefined;
  if (failedQuery) return <View style={layout.section}>
    <Text accessibilityRole="alert" style={layout.muted}>Could not load current rounds.</Text>
    <Button emphasis="link" onPress={() => void failedQuery.mutate().catch(() => {})}>Retry rounds</Button>
  </View>;
  if (query.room.isLoading || query.rounds.isLoading) return <ActivityIndicator accessibilityLabel="Loading rounds" />;
  return <>{query.current.map(round => <CurrentRound key={round.id} round={round} participation={query.participation} reportActions={reportActions} compact={compact} />)}</>;
}
/** Approved paired-row presentation, driven by authorized room snapshots. */
export function RoomHome({ query, openEntry, openHistory, historyRef }: {
  query: ReturnType<typeof useRoomHome>;
  openEntry: (entry: WallProcessEntry, reply?: string) => void;
  openHistory: () => void;
  historyRef?: Ref<View>;
}) {
  const scroll = useRef<ScrollView>(null);
  const restore = useRef(true);
  const initialPosition = useRef(query.position.data ?? 0);
  const home = !query.home.error && !query.room.error ? query.home.data : undefined;
  const members = home?.members ?? [];
  if (!home && !query.home.error && !query.room.error) return <RoomLoading />;
  return <PageScrollView ref={scroll} contentContainerStyle={styles.content}
    scrollEventThrottle={100}
    onScroll={event => { if (!restore.current) void query.position.mutate(event.nativeEvent.contentOffset.y, { revalidate: false }); }}
    onContentSizeChange={(_, height) => {
      if (home && restore.current && height > 0) {
        scroll.current?.scrollTo({ y: initialPosition.current, animated: false });
        restore.current = false;
      }
    }}>
    <RoomRoundContext query={query} />
    {(query.home.error || query.room.error) && <View style={layout.section}>
      <Text accessibilityRole="alert" style={layout.text}>Could not load this Room.</Text>
      <Button onPress={() => void Promise.allSettled([query.home.mutate(), query.room.mutate()])}>Try again</Button>
    </View>}
    {home && <RoomWall members={roomWallMembers(members)}
      emptyMessage="Nothing shared yet."
      onOpenEntry={openEntry} onOpenFeedback={entry => openEntry(entry)} />}
    <Button ref={historyRef} emphasis="link" onPress={openHistory}>Round history</Button>
  </PageScrollView>;
}
const styles = StyleSheet.create({
  content: { gap: 24, paddingTop: 12 },
});
