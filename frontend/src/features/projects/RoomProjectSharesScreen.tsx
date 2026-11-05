import { useRef } from "react";
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { PageScrollView } from "../../components/PageScrollView";
import { ViewportShell } from "../../components/ViewportShell";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { useRoomProjectShares } from "../../hooks/useRoomProjectShares";
import { EntryContent } from "../content/EntryContent";
import { RoomHeader } from "../rooms/RoomHeader";
import { ProjectIcon } from "./ProjectIcon";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";

export function RoomProjectSharesScreen() {
  const { entryId } = useLocalSearchParams<{ entryId: string }>();
  const query = useRoomProjectShares(entryId);
  const navigation = useRoomNavigation();
  const header = useRef<View>(null);
  const shelf = useRef<View>(null);
  const page = query.data?.[0];
  return (
    <ViewportShell>
      <RoomHeader title={page?.room?.name || "Room"} avatar={page?.room?.avatar_url}
        detailsOpen={false} shelfOpen={false} hasSides={false} detailsRef={header} shelfRef={shelf}
        backIcon="caretLeft" backLabel="Back to shared work"
        onBack={() => navigation.returnTo(`/app/entries/${entryId}`)}
        onDetails={() => page?.room && navigation.destination(`/app/rooms/${page.room.id}?panel=details`)}
        onShelf={() => {}} />
      <PageScrollView contentContainerStyle={styles.content}>
        {page && <View style={styles.identity}>
          <ProjectIcon name={page.project.name} />
          <Text style={layout.title}>{page.project.name}</Text>
        </View>}
        {query.isLoading && <ActivityIndicator accessibilityLabel="Loading shared work" />}
        {query.error ? <View style={styles.content}>
          <Text style={layout.text}>Couldn’t load shared work.</Text>
          <Button onPress={() => void query.mutate()}>Try again</Button>
        </View> : query.items.map(item => (
          <Button key={item.id} emphasis="ghost" style={styles.card}
            accessibilityLabel="Open shared work" onPress={() => navigation.destination(`/app/entries/${item.id}`)}>
            <EntryContent entry={{ content: item.content, format: item.format, format_data: item.format_data ?? null, room_statement: item.room_statement, shared_feedback: item.shared_feedback }} interactive={false} />
          </Button>
        ))}
        {page && !query.error && !query.items.length && <Text style={layout.text}>Nothing shared.</Text>}
        {query.hasMore && <Button disabled={query.isValidating} onPress={() => void query.loadMore()}>Show more</Button>}
      </PageScrollView>
    </ViewportShell>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12 },
  identity: { flexDirection: "row", alignItems: "center", gap: 8 },
  card: { alignItems: "stretch", padding: 8, backgroundColor: tokens.surface, borderRadius: 16 },
});
