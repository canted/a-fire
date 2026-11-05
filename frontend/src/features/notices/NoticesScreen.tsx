import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { RoomIcon } from "../../components/RoomIcon";
import { UserAvatar } from "../../components/UserAvatar";
import { ViewportShell } from "../../components/ViewportShell";
import { useNotices } from "../../hooks/useNotices";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { useContentLink } from "../../hooks/useContentLink";
import { noticeActionParts } from "../../lib/noticePresentation";
import { noticePreviewText } from "../../lib/noticePreview";
import { formatCompactRelativeTime } from "../../lib/time";
import type { Notice } from "../../lib/api/noticeTypes";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";
export function NoticesScreen() {
  const query = useNotices();
  const navigation = useRoomNavigation();
  const links = useContentLink();
  const [error, setError] = useState<string>();
  const mark = async (item: Notice | "all") => {
    setError(undefined);
    try {
      await query.mark(item);
    } catch {
      setError("Could not mark notices as read. Try again.");
    }
  };
  const load = () => {
    if (query.hasMore && !query.query.isValidating)
      void query.query.setSize(query.query.size + 1).catch(() => {});
  };
  return (
    <ViewportShell>
      <View style={[layout.content, layout.row]}>
        <Button
          size="icon"
          emphasis="bare"
          accessibilityLabel="Back to Home"
          onPress={() => navigation.home()}
        >
          <Icon name="caretCircleLeft" size={28} />
        </Button>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          ellipsizeMode="tail"
          style={layout.appBarTitle}
        >
          Notices
        </Text>
        <Button
          emphasis="bare"
          accessibilityLabel="Notification settings"
          onPress={() =>
            navigation.destination("/app/notification-preferences")
          }
        >
          <Icon name="gearFine" size={24} />
        </Button>
      </View>
      <FlatList
        data={query.items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          layout.content,
          styles.list,
          layout.audioClearance,
        ]}
        onEndReached={load}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View style={layout.section}>
            <Button
              emphasis="link"
              disabled={query.busy || !query.items.length}
              onPress={() => {
                void mark("all");
              }}
            >
              mark all as read
            </Button>
            {(error || links.error) && (
              <Text accessibilityRole="alert" style={layout.text}>
                {error || links.error}
              </Text>
            )}
            {query.query.error && (
              <>
                <Text accessibilityRole="alert" style={layout.text}>
                  Could not load notices right now.
                </Text>
                <Button
                  onPress={() => {
                    void query.query.mutate().catch(() => {});
                  }}
                >
                  Try again
                </Button>
              </>
            )}
          </View>
        }
        ListEmptyComponent={
          query.query.isLoading ? (
            <ActivityIndicator accessibilityLabel="Loading notices" />
          ) : !query.query.error ? (
            <Text style={layout.muted}>No notices yet.</Text>
          ) : null
        }
        ListFooterComponent={
          query.hasMore ? (
            <Button
              disabled={query.query.isValidating}
              emphasis="link"
              onPress={load}
            >
              {query.query.isValidating ? "Loading more notices…" : "Load more"}
            </Button>
          ) : null
        }
        renderItem={({ item }) => (
          <NoticeRow
            notice={item}
            onOpen={() => {
              if (item.type !== "chat") void mark(item);
              void links.open(
                item.targetUrl ||
                  (item.entryId ? `/app/entries/${item.entryId}` : "/app"),
              );
            }}
          />
        )}
      />
    </ViewportShell>
  );
}
function NoticeRow({ notice, onOpen }: { notice: Notice; onOpen: () => void }) {
  const parts = noticeActionParts(notice);
  const preview = noticePreviewText(notice);
  const names = parts.actors.map((actor) => actor.name).join(" and ");
  return (
    <Button
      emphasis="bare"
      style={[styles.card, !notice.contentSeen && styles.unseen]}
      accessibilityLabel={`${names} ${parts.actionText}`}
      onPress={onOpen}
    >
      <RoomIcon
        name={notice.roomName || "Room"}
        avatarUrl={notice.roomAvatarUrl}
        size={40}
      />
      <View style={layout.grow}>
        <View style={styles.heading}>
          {parts.actors.map((actor, index) => (
            <View key={`${actor.name}-${index}`} style={styles.actor}>
              <UserAvatar
                username={actor.name}
                avatarUrl={actor.avatarUrl}
                size={16}
              />
              <Text style={styles.title}>
                {actor.name}
                {index < parts.actors.length - 1 ? " and" : ""}
              </Text>
            </View>
          ))}
          {parts.remainingActorCount > 0 && (
            <Text style={styles.title}>
              and {parts.remainingActorCount}{" "}
              {parts.remainingActorCount === 1 ? "other" : "others"}
            </Text>
          )}
          <Text style={styles.title}>{parts.actionText}</Text>
          <Text style={styles.time}>
            {formatCompactRelativeTime(notice.createdAt)}
          </Text>
        </View>
        {Boolean(preview) && (
          <Text numberOfLines={3} style={styles.preview}>
            {preview}
          </Text>
        )}
      </View>
    </Button>
  );
}
const styles = StyleSheet.create({
  list: { paddingVertical: 12, gap: 8 },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 12,
    borderRadius: tokens.radius,
    backgroundColor: tokens.paper,
  },
  unseen: { backgroundColor: tokens.coolSoft },
  heading: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 4,
  },
  actor: { flexDirection: "row", alignItems: "center", gap: 4 },
  title: { fontFamily: "LatoBold", fontSize: 14, color: tokens.ink },
  time: {
    fontFamily: "Lato",
    fontSize: 12,
    color: tokens.muted,
    marginLeft: "auto",
  },
  preview: {
    fontFamily: "Lato",
    fontSize: 14,
    lineHeight: 20,
    color: tokens.ink,
    marginTop: 6,
  },
});
