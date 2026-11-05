import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ViewportShell } from "../../components/ViewportShell";
import { Button } from "../../components/Button";
import { RoomIcon } from "../../components/RoomIcon";
import { Icon } from "../../components/Icon";
import { useRooms } from "../../hooks/useRooms";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";

export function AllRoomsScreen() {
  const rooms = useRooms();
  const navigation = useRoomNavigation();
  return (
    <ViewportShell>
      <View style={[layout.content, layout.appBar]}>
        <Button
          accessibilityLabel="Back to Home"
          size="icon"
          emphasis="bare"
          onPress={navigation.home}
        >
          <Icon name="caretCircleLeft" size={28} />
        </Button>
        <Text accessibilityRole="header" style={layout.appBarTitle}>
          All Rooms
        </Text>
        <Button emphasis="bare" accessibilityLabel="New Room" onPress={() => navigation.destination("/app/rooms/new")}><Icon name="plusBold" size={20} /></Button>
      </View>
      {rooms.isLoading && (
        <ActivityIndicator accessibilityLabel="Loading rooms" />
      )}
      {rooms.error ? (
        <View style={[layout.content, layout.section]}>
          <Text accessibilityRole="alert" style={layout.text}>
            Could not load rooms.
          </Text>
          <Button
            onPress={() => {
              void rooms.mutate().catch(() => {});
            }}
          >
            Retry rooms
          </Button>
        </View>
      ) : (
        <FlatList
          accessibilityLabel="All Rooms"
          data={rooms.data?.rooms ?? []}
          keyExtractor={(room) => String(room.id)}
          contentContainerStyle={layout.content}
          renderItem={({ item }) => (
            <Button
              emphasis="ghost"
              accessibilityLabel={`Enter ${item.name || "Room"}`}
              style={styles.row}
              onPress={() => navigation.enter(String(item.id))}
            >
              <RoomIcon
                avatarUrl={item.avatar_url}
                name={item.name || "Room"}
              />
              <Text style={[layout.text, layout.grow]}>
                {item.name || "Room"}
              </Text>
              <Icon name="caretRight" size={16} />
            </Button>
          )}
          ListEmptyComponent={
            !rooms.isLoading ? (
              <Text style={layout.muted}>
                You are not part of any rooms yet.
              </Text>
            ) : null
          }
        />
      )}
    </ViewportShell>
  );
}
const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-start",
    backgroundColor: tokens.paper,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border,
    minHeight: 48,
  },
});
