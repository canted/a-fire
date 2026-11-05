import { NoteTree } from "./NoteTree";
import { PopupMenu } from "../../components/PopupMenu";
import { Icon } from "../../components/Icon";
import { useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../../components/Button";
import { RoomWorkspace } from "../rooms/RoomWorkspace";
import { useRoomNotes } from "../../hooks/useNotes";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import type { NoteTreeNode } from "../../lib/api/notes";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";
export function RoomNotesScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const query = useRoomNotes(roomId);
  const navigation = useRoomNavigation();
  const menuAnchor = useRef<View>(null);
  const [menu, setMenu] = useState<NoteTreeNode>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string>();
  const create = async (parent?: number) => {
    try {
      setError(undefined);
      const note = await query.create.trigger({ parent });
      navigation.destination(`/app/note/${note.id}`);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not create a note. Try again.",
      );
    }
  };
  return (
    <RoomWorkspace
      backToChat={false}
      roomId={roomId}
      room={query.denied ? undefined : query.room.data}
      denied={query.denied || Boolean(query.room.error)}
    >
      <ScrollView contentContainerStyle={[layout.content, styles.content]}>
        {query.denied ? (
          <Text accessibilityRole="alert" style={layout.text}>
            This Room is unavailable or you no longer have access to its Notes.
          </Text>
        ) : query.room.isLoading ? (
          <ActivityIndicator accessibilityLabel="Loading Notes access" />
        ) : query.room.error ? (
          <Button
            style={styles.target}
            onPress={() => {
              void query.room.mutate().catch(() => {});
            }}
          >
            Retry Notes access
          </Button>
        ) : !query.allowed ? (
          <Text accessibilityRole="alert" style={layout.text}>
            Notes are available to Room members.
          </Text>
        ) : (
          <>
            {query.tree.isLoading && (
              <ActivityIndicator accessibilityLabel="Loading Notes" />
            )}
            {query.tree.error && (
              <Button
                style={styles.target}
                onPress={() => {
                  void query.tree.mutate().catch(() => {});
                }}
              >
                Retry Notes
              </Button>
            )}
            {!query.tree.error && (
              <NoteTree
                nodes={query.tree.data?.pages ?? []}
                onOpen={(item) =>
                  navigation.destination(`/app/note/${item.id}`)
                }
                onMenu={(item) => {
                  setMenu(item);
                  setConfirmDelete(false);
                }}
                menuId={menu?.id}
                menuRef={menuAnchor}
              />
            )}
            {query.tree.data?.pages.length === 0 && (
              <View style={styles.empty}>
                <Text style={layout.muted}>No notes yet.</Text>
                <Button
                  emphasis="outline"
                  shape="pill"
                  disabled={query.create.isMutating}
                  onPress={() => {
                    void create();
                  }}
                >
                  Create a note
                </Button>
              </View>
            )}
          </>
        )}
        {error && (
          <Text accessibilityRole="alert" style={layout.text}>
            {error}
          </Text>
        )}
      </ScrollView>
      {query.allowed && (
        <View pointerEvents="box-none" style={styles.createDock}>
          <Button
            style={[styles.target, styles.createButton]}
            shape="pill"
            accessibilityLabel="New note"
            disabled={query.create.isMutating}
            onPress={() => {
              void create();
            }}
          >
            <Icon name="filePlus" size={32} color={tokens.paper} />
          </Button>
        </View>
      )}
      <PopupMenu
        mode="menu"
        open={Boolean(menu)}
        anchor={menuAnchor}
        title={confirmDelete ? "Delete this note?" : "Note actions"}
        onClose={() => {
          if (!query.remove.isMutating) setMenu(undefined);
        }}
        actions={[
          {
            id: "delete",
            label: query.remove.isMutating ? "Deleting…" : "Delete this note",
            disabled: query.remove.isMutating,
            onSelect: () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              if (menu)
                void query.remove
                  .trigger(menu.id)
                  .then(() => setMenu(undefined))
                  .catch((reason) => {
                    setMenu(undefined);
                    setError(reason.message);
                  });
            },
          },
          {
            id: "cancel",
            label: "Cancel",
            disabled: query.remove.isMutating,
            onSelect: () => setMenu(undefined),
          },
        ]}
      />
    </RoomWorkspace>
  );
}
const styles = StyleSheet.create({
  content: { paddingTop: 72, paddingBottom: 116 },
  empty: {
    minHeight: 224,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  createButton: {
    width: 56,
    height: 56,
    minHeight: 56,
    backgroundColor: tokens.cool,
    padding: 0,
    boxShadow: "0 3px 12px rgba(26,37,39,0.15)",
  },
  createDock: {
    position: "absolute",
    bottom: 28,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    alignItems: "flex-end",
    paddingHorizontal: 12,
  },
  target: { minHeight: 48, minWidth: 48 },
});
