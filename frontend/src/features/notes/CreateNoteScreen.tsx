import { Redirect, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { RoomWorkspace } from "../rooms/RoomWorkspace";
import { useNewNoteRoute } from "../../hooks/useNotes";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { layout } from "../../styles/layout";
export function CreateNoteScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const query = useNewNoteRoute(roomId);
  const navigation = useRoomNavigation();
  if (query.id && query.allowed)
    return <Redirect href={`/app/note/${query.id}`} />;
  return (
    <RoomWorkspace
      roomId={roomId}
      room={query.denied ? undefined : query.room.data}
      denied={query.denied || Boolean(query.room.error)}
    >
      <View style={[layout.content, layout.section]}>
        {query.denied ? (
          <Text accessibilityRole="alert" style={layout.text}>
            This Room is unavailable or you no longer have access to its Notes.
          </Text>
        ) : query.room.error ? (
          <>
            <Text accessibilityRole="alert" style={layout.text}>
              Couldn’t check your Notes access.
            </Text>
            <Button
              onPress={() => {
                void query.room.mutate().catch(() => {});
              }}
            >
              Try again
            </Button>
          </>
        ) : !query.room.isLoading && !query.allowed ? (
          <Text accessibilityRole="alert" style={layout.text}>
            Notes are available to Room members.
          </Text>
        ) : query.error ? (
          <>
            <Text accessibilityRole="alert" style={layout.text}>
              {query.error}
            </Text>
            <Button onPress={query.retry}>Try again</Button>
          </>
        ) : (
          <ActivityIndicator accessibilityLabel="Creating note" />
        )}
        <Button
          emphasis="link"
          onPress={() =>
            query.denied
              ? navigation.home()
              : navigation.ancestor(`/app/rooms/${roomId}/notes`)
          }
        >
          {query.denied ? "Back to Home" : "Back to Notes"}
        </Button>
      </View>
    </RoomWorkspace>
  );
}
