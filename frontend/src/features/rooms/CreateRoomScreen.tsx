import { useImageSelection } from "../../hooks/useImageSelection";
import { PageScrollView } from "../../components/PageScrollView";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { Icon } from "../../components/Icon";
import { RoomIcon } from "../../components/RoomIcon";
import { AppImage } from "../../components/AppImage";
import { ViewportShell } from "../../components/ViewportShell";
import { RoomInvites } from "../invites/RoomInvitesScreen";
import { useRoomCreation } from "../../hooks/useRoomCreation";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { useDraftNavigation } from "../../hooks/useDraftNavigation";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";

export function CreateRoomScreen() {
  const navigation = useRoomNavigation();
  const creation = useRoomCreation();
  const [name, setName] = useState("");
  const { image: avatar, choose: chooseImage, clear: clearImage } = useImageSelection();
  const [createdId, setCreatedId] = useState<string>();
  const [error, setError] = useState<string>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useDraftNavigation({
    dirty: false,
    busy: creation.isMutating,
    busyMessage: "Wait for your Room to finish saving.",
    save: async () => {},
    onError: setError,
  });
  const choose = async () => {
    setError(undefined);
    try {
      await chooseImage();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not select the Room icon.",
      );
    }
  };
  const submit = async () => {
    if (!name.trim() || creation.isMutating || createdId) return;
    setError(undefined);
    try {
      const room = await creation.submit({ name, avatar });
      if (mounted.current) setCreatedId(String(room.id));
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not create Room. Try again.",
        );
    }
  };
  return (
    <ViewportShell>
      <View style={[layout.content, styles.header]}>
        <Button
          size="icon"
          emphasis="bare"
          accessibilityLabel="Back to Home"
          disabled={creation.isMutating}
          onPress={() => navigation.home()}
        >
          <Icon name="caretCircleLeft" size={28} />
        </Button>
      </View>
      <PageScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[layout.section]}
      >
        <Text accessibilityRole="header" style={layout.title}>
          Name your room
        </Text>
        <Text style={layout.muted}>
          Set the basics, then invite people to join.
        </Text>
        <View style={styles.panel}>
          <Text accessibilityRole="header" style={styles.heading}>
            Room details
          </Text>
          <Text style={layout.text}>Room name</Text>
          <Input
            accessibilityLabel="Room name"
            placeholder="e.g. Neighborhood Builders"
            value={name}
            onChangeText={setName}
            editable={!creation.isMutating && !createdId}
            onSubmitEditing={() => {
              void submit();
            }}
            returnKeyType="done"
          />
          <Text style={layout.text}>Room icon</Text>
          <View style={styles.iconRow}>
            <View style={styles.preview}>
              {avatar ? (
                <AppImage
                  src=""
                  localPreview={avatar}
                  alt="Room icon preview"
                  tiled
                />
              ) : (
                <RoomIcon name={name || "Room"} size={80} />
              )}
            </View>
            <View style={layout.section}>
              <Button
                shape="pill"
                emphasis="outline"
                disabled={creation.isMutating || Boolean(createdId)}
                onPress={() => {
                  void choose();
                }}
              >
                {avatar ? "Change icon" : "Add icon"}
              </Button>
              {avatar && !createdId && (
                <Button
                  emphasis="link"
                  disabled={creation.isMutating}
                  onPress={() => {
                    clearImage();
                  }}
                >
                  Remove icon
                </Button>
              )}
            </View>
          </View>
          {error && (
            <Text accessibilityRole="alert" style={layout.text}>
              {error}
            </Text>
          )}
          {createdId ? (
            <Text accessibilityLiveRegion="polite" style={layout.text}>
              Saved! Invite people below.
            </Text>
          ) : (
            <View style={styles.actions}>
              <Button
                shape="pill"
                disabled={!name.trim() || creation.isMutating}
                onPress={() => {
                  void submit();
                }}
              >
                {creation.isMutating ? "Saving…" : "Save and continue"}
              </Button>
            </View>
          )}
        </View>
        {createdId && (
          <>
            <View style={styles.panel}>
              <Text accessibilityRole="header" style={styles.heading}>
                Invite members
              </Text>
              <RoomInvites room={createdId} />
            </View>
            <Button shape="pill" onPress={() => navigation.enter(createdId)}>
              Open Room
            </Button>
          </>
        )}
      </PageScrollView>
    </ViewportShell>
  );
}
const styles = StyleSheet.create({
  header: { height: 44, justifyContent: "center", alignItems: "flex-start" },
  panel: {
    backgroundColor: tokens.paper,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  heading: { color: tokens.ink, fontFamily: "PoppinsSemibold", fontSize: 18 },
  iconRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  preview: {
    width: 80,
    height: 80,
    borderRadius: tokens.radius,
    overflow: "hidden",
  },
  actions: { alignItems: "flex-end" },
});
