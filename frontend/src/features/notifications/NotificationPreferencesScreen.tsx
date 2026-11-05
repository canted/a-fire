import { PageScrollView } from "../../components/PageScrollView";
import { usePushSubscription } from "../../hooks/usePushSubscription";
import { Select } from "../../components/Select";
import { Icon } from "../../components/Icon";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { RoomIcon } from "../../components/RoomIcon";
import { ViewportShell } from "../../components/ViewportShell";
import { useNotificationPreferences } from "../../hooks/useNotificationPreferences";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";
const options = [
  { value: "all", label: "Everything" },
  { value: "entries", label: "Entries and mentions only" },
  { value: "none", label: "Nothing (mute)" },
] as const;
export function NotificationPreferencesScreen() {
  const navigation = useRoomNavigation();
  const push = usePushSubscription();
  const { query, update } = useNotificationPreferences();
  const [error, setError] = useState<string>();
  return (
    <ViewportShell>
      <PageScrollView contentContainerStyle={[layout.section]}>
        <View style={layout.row}>
          <Button
            size="icon"
            style={styles.target}
            emphasis="ghost"
            onPress={() => navigation.returnTo()}
            accessibilityLabel="Back"
          >
            <Icon name="caretCircleLeft" size={28} />
          </Button>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            ellipsizeMode="tail"
            style={layout.appBarTitle}
          >
            Notification preferences
          </Text>
        </View>
        {push.supportedPlatform ? (
          <View style={layout.section}>
            <View style={layout.row}>
              <View style={layout.grow}>
                <Text style={layout.text}>App notifications</Text>
                <Text style={layout.muted}>
                  {push.query.data?.permission === "denied"
                    ? "Notifications are blocked in your device settings."
                    : "Enable push alerts and badges for new rounds."}
                </Text>
              </View>
              <Button
                emphasis="bare"
                accessibilityRole="switch"
                accessibilityLabel="App notifications"
                checked={Boolean(push.query.data?.subscribed)}
                disabled={
                  push.query.isLoading ||
                  push.update.isMutating ||
                  push.query.data?.permission === "unsupported"
                }
                onPress={() => {
                  void push.update
                    .trigger(!push.query.data?.subscribed)
                    .catch(() => {});
                }}
              >
                <View
                  style={[
                    styles.track,
                    push.query.data?.subscribed && styles.trackOn,
                  ]}
                >
                  <View
                    style={[
                      styles.thumb,
                      push.query.data?.subscribed && styles.thumbOn,
                    ]}
                  />
                </View>
              </Button>
            </View>
            {push.query.data?.permission === "unsupported" && (
              <Text style={layout.muted}>
                Push notifications are not supported on this device.
              </Text>
            )}
            {(push.update.error || push.query.error) && (
              <Text accessibilityRole="alert" style={layout.text}>
                {push.update.error instanceof Error
                  ? push.update.error.message
                  : "Could not load notification status."}
              </Text>
            )}
          </View>
        ) : (
          <Text style={layout.muted}>
            Choose what you receive from each Room. Native push notifications
            are not available in this preview yet.
          </Text>
        )}
        {query.isLoading && (
          <ActivityIndicator accessibilityLabel="Loading notification preferences" />
        )}
        {query.error && (
          <>
            <Text accessibilityRole="alert" style={layout.text}>
              Could not load preferences.
            </Text>
            <Button
              style={styles.target}
              onPress={() => {
                void query.mutate().catch(() => {});
              }}
            >
              Retry
            </Button>
          </>
        )}
        {error && (
          <Text accessibilityRole="alert" style={layout.text}>
            {error}
          </Text>
        )}
        {!query.error &&
          query.data?.map((item) => (
            <View key={item.roomId} style={layout.section}>
              <View style={[layout.row, styles.identity]}>
                <RoomIcon
                  name={item.roomName || "Room"}
                  avatarUrl={item.roomAvatarUrl}
                />
                <Text
                  accessibilityRole="header"
                  style={[layout.text, styles.name]}
                >
                  {item.roomName || "Room"}
                </Text>
              </View>
              <Text style={layout.muted}>What to notify you about</Text>
              <Select
                label={`${item.roomName || "Room"} notifications`}
                value={item.notificationType}
                options={options}
                disabled={update.isMutating}
                onValueChange={(notificationType) => {
                  setError(undefined);
                  void update
                    .trigger({
                      roomId: item.roomId,
                      notificationType,
                    })
                    .catch(() =>
                      setError(
                        "Could not save this preference. Please try again.",
                      ),
                    );
                }}
              />
            </View>
          ))}
        {query.data?.length === 0 && (
          <Text style={layout.muted}>No Room preferences yet.</Text>
        )}
      </PageScrollView>
    </ViewportShell>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 36,
    height: 20,
    borderRadius: 999,
    backgroundColor: tokens.border,
    padding: 2,
  },
  trackOn: { backgroundColor: tokens.ink },
  thumb: {
    width: 16,
    height: 16,
    borderRadius: 999,
    backgroundColor: tokens.paper,
  },
  thumbOn: { transform: [{ translateX: 16 }] },
  target: { minHeight: 48, minWidth: 48 },
  identity: { justifyContent: "flex-start" },
  name: { flexShrink: 1, minWidth: 0 },
});
