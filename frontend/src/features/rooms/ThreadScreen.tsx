import { useRooms } from "../../hooks/useRooms";
import { RoomIcon } from "../../components/RoomIcon";
import { UserAvatar } from "../../components/UserAvatar";
import { ProjectIcon } from "../projects/ProjectIcon";
import { Icon } from "../../components/Icon";
import { adjacentMessages } from "../../lib/chatThreadContext";
import { useContentLink } from "../../hooks/useContentLink";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { useCallback, useMemo } from "react";
import { useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { replyAsRoomMessage } from "../../lib/api/chatThread";
import { virtualMessageGroups } from "../../lib/messageGroups";
import type { RoomMessage } from "../../lib/api/room";
import { Button } from "../../components/Button";
import { ViewportShell } from "../../components/ViewportShell";
import {
  useThreadContext,
  useThreadMessage,
  useThreadReplies,
} from "../../hooks/useChatActions";
import { RoomExposure, useRoomExposure } from "../../hooks/useRoomExposure";
import { MessageGroup } from "./MessageGroup";
import { layout } from "../../styles/layout";

export function ThreadScreen() {
  const { roomId, messageId } = useLocalSearchParams<{
    roomId: string;
    messageId: string;
  }>();
  return (
    <ThreadFlow
      key={`${roomId}:${messageId}`}
      room={roomId}
      message={messageId}
    />
  );
}
function ThreadFlow({ room, message }: { room: string; message: string }) {
  const navigation = useRoomNavigation();
  const rooms = useRooms();
  const identity = rooms.data?.rooms.find((item) => String(item.id) === room);
  const source = useThreadMessage(room, message);
  const replies = useThreadReplies(room, message);
  const history = useThreadContext(room);
  const links = useContentLink();
  const neighbors = adjacentMessages(
    (history.data?.messages ?? []).filter(
      (item) =>
        item.kind === "message" && item.author?.id === source.data?.author?.id,
    ),
    message,
  );
  const project = source.data?.entry?.project;
  const projectNeighbors = adjacentMessages(
    (history.data?.messages ?? []).filter(
      (item) => item.entry?.project?.id === project?.id && Boolean(project),
    ),
    message,
  );
  const sourceExposure = useRoomExposure(room);
  const replyExposure = useRoomExposure(room, message);
  const onViewableItemsChanged = useCallback(
    (info: Parameters<typeof replyExposure.onViewableItemsChanged>[0]) => {
      sourceExposure.onViewableItemsChanged(info);
      replyExposure.onViewableItemsChanged(info);
    },
    [
      sourceExposure.onViewableItemsChanged,
      replyExposure.onViewableItemsChanged,
    ],
  );
  const groups = useMemo(() => {
    const adapted: RoomMessage[] = (replies.data?.replies ?? []).map(
      replyAsRoomMessage,
    );
    const historical = virtualMessageGroups(
      adapted,
      (item) => String(item.id),
      (item) => item.author?.id,
    ).map((group) => ({ ...group, key: `reply-${group.key}` }));
    return source.data
      ? [
          {
            ...virtualMessageGroups(
              [source.data],
              (item) => String(item.id),
              (item) => item.author?.id,
            )[0],
            key: "source",
          },
          ...historical,
        ]
      : historical;
  }, [source.data, replies.data]);
  const unavailable = Boolean(source.error || replies.error);
  return (
    <ViewportShell>
      <View style={[layout.content, layout.section]}>
        <View style={[layout.row, styles.wrap]}>
          <Button
            size="icon"
            style={styles.target}
            emphasis="ghost"
            accessibilityLabel="Back to Chat"
            onPress={() => navigation.back(room, message)}
          >
            <Icon name="caretCircleLeft" size={28} />
          </Button>
          <Button
            emphasis="bare"
            accessibilityLabel="Show source in Chat"
            style={layout.row}
            onPress={() => navigation.source(room, message)}
          >
            <RoomIcon
              name={identity?.name || "Room"}
              avatarUrl={identity?.avatar_url}
              size={24}
            />
            <Text accessibilityRole="header" style={layout.title}>
              {identity?.name || "Room"}
            </Text>
          </Button>
        </View>
        <Text style={layout.muted}>
          Past replies are kept here. Continue the conversation in Chat.
        </Text>

        {!unavailable && source.data && (
          <View style={[layout.row, styles.wrap]}>
            <UserAvatar
              username={source.data.author?.display_username || "Member"}
              avatarUrl={source.data.author?.avatar_url}
              size={32}
            />
            <Text style={[layout.text, layout.grow]}>
              {source.data.author?.display_username || "Entries"}
            </Text>
            {(neighbors.previous || neighbors.next) && (
              <View style={styles.stepper}>
                {neighbors.previous ? (
                  <Button
                    size="icon"
                    style={styles.target}
                    emphasis="link"
                    onPress={() =>
                      navigation.thread(room, neighbors.previous!.id)
                    }
                    accessibilityLabel="Previous by this author"
                  >
                    <View>
                      <Icon name="caretCircleLeft" size={28} />
                    </View>
                  </Button>
                ) : (
                  <View style={styles.target} />
                )}
                <Text style={layout.muted}>Entries</Text>
                {neighbors.next ? (
                  <Button
                    size="icon"
                    style={styles.target}
                    emphasis="link"
                    onPress={() => navigation.thread(room, neighbors.next!.id)}
                    accessibilityLabel="Next by this author"
                  >
                    <View style={{ transform: [{ rotate: "180deg" }] }}>
                      <Icon name="caretCircleLeft" size={28} />
                    </View>
                  </Button>
                ) : (
                  <View style={styles.target} />
                )}
              </View>
            )}
          </View>
        )}
        {!unavailable && project && (
          <View style={[layout.row, styles.wrap]}>
            <Button
              style={[layout.row, layout.grow]}
              emphasis="bare"
              onPress={() => {
                void links.open(`/app/projects/${project.id}`);
              }}
            >
              <ProjectIcon
                name={project.name}
                imageUrl={project.icon_url}
                size={32}
              />
              <Text style={[layout.text, layout.grow]}>{project.name}</Text>
            </Button>
            {(projectNeighbors.previous || projectNeighbors.next) && (
              <View style={styles.stepper}>
                {projectNeighbors.previous ? (
                  <Button
                    size="icon"
                    style={styles.target}
                    emphasis="bare"
                    onPress={() =>
                      navigation.thread(room, projectNeighbors.previous!.id)
                    }
                    accessibilityLabel="Previous in project"
                  >
                    <Icon name="caretCircleLeft" size={28} />
                  </Button>
                ) : (
                  <View style={styles.target} />
                )}
                <Text style={layout.muted}>Entries</Text>
                {projectNeighbors.next ? (
                  <Button
                    size="icon"
                    style={styles.target}
                    emphasis="bare"
                    onPress={() =>
                      navigation.thread(room, projectNeighbors.next!.id)
                    }
                    accessibilityLabel="Next in project"
                  >
                    <View style={{ transform: [{ rotate: "180deg" }] }}>
                      <Icon name="caretCircleLeft" size={28} />
                    </View>
                  </Button>
                ) : (
                  <View style={styles.target} />
                )}
              </View>
            )}
          </View>
        )}
        {!unavailable && source.data?.entry && !project && (
          <Button
            emphasis="bare"
            style={layout.row}
            accessibilityLabel="Add entry to a project"
            onPress={() =>
              navigation.destination(
                `/app/entries/${source.data!.entry!.id}/project`,
              )
            }
          >
            <Icon name="plus" size={18} />
            <Text style={layout.text}>Add to project</Text>
          </Button>
        )}
        {links.error && (
          <Text accessibilityRole="alert" style={layout.text}>
            {links.error}
          </Text>
        )}
      </View>
      {(source.isLoading || replies.isLoading) && (
        <ActivityIndicator accessibilityLabel="Loading past replies" />
      )}
      {unavailable ? (
        <View style={[layout.content, layout.section]}>
          <Text accessibilityRole="alert" style={layout.text}>
            This reply thread could not be loaded.
          </Text>
          <Button
            style={styles.target}
            onPress={() => {
              void Promise.allSettled([source.mutate(), replies.mutate()]);
            }}
          >
            Retry thread
          </Button>
        </View>
      ) : (
        <View
          ref={(node) => {
            sourceExposure.viewport.current = node;
            replyExposure.viewport.current = node;
          }}
          style={layout.grow}
          collapsable={false}
        >
          <FlatList
            accessibilityLabel="Historical replies"
            data={groups}
            keyExtractor={(item) => item.key}
            contentContainerStyle={[
              layout.content,
              layout.section,
              layout.audioClearance,
            ]}
            initialNumToRender={4}
            windowSize={5}
            viewabilityConfig={replyExposure.viewabilityConfig}
            onViewableItemsChanged={onViewableItemsChanged}
            renderItem={({ item }) => (
              <RoomExposure.Provider
                value={
                  item.key === "source"
                    ? sourceExposure.register
                    : replyExposure.register
                }
              >
                <MessageGroup group={item} />
              </RoomExposure.Provider>
            )}
            ListFooterComponent={
              replies.hasNextPage ? <Button disabled={replies.isValidating} onPress={() => { void replies.fetchNextPage(); }}>Load more replies</Button> : !replies.isLoading && replies.data?.replies.length === 0 ? (
                <Text style={layout.muted}>No past replies.</Text>
              ) : null
            }
          />
        </View>
      )}
    </ViewportShell>
  );
}

const styles = StyleSheet.create({
  target: { minHeight: 48, minWidth: 48 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  wrap: { flexWrap: "wrap" },
});
