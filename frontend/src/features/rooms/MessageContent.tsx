import { firstLinkPreviewUrl } from "../../lib/linkPreviewDetection";
import { LinkPreviewCard } from "../content/LinkPreviewCard";
import { Icon } from "../../components/Icon";
import { formatChatTimestamp, parseTimestamp } from "../../lib/time";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { RoomMessage } from "../../lib/api/room";
import { appRoutes } from "../../lib/appRoutes";
import { DocumentContent } from "../content/DocumentContent";
import { EntryContent } from "../content/EntryContent";
import {
  useMessageGestureBoundary,
  useMessageTextSelectable,
} from "../../hooks/useMessageGestureBoundary";
import { Button } from "../../components/Button";
import { UserAvatar } from "../../components/UserAvatar";
import { useContentLink } from "../../hooks/useContentLink";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";
import { hasTiptapNodeType } from "../../lib/tiptap";

export function MessageContent({
  message,
  room,
  showDestinations = true,
}: {
  room?: string;
  message: RoomMessage;
  showDestinations?: boolean;
}) {
  const links = useContentLink();
  const protectTouch = useMessageGestureBoundary();
  const selectable = useMessageTextSelectable();
  const entry = message.entry;
  const event = message.round_event;
  const activityResult =
    entry?.available &&
    (entry.format_data?.round_attribution?.template_key ??
      entry.format_data?.round_activity?.activity_key) === "art_before_chorus";
  const attachment =
    entry?.available &&
    !activityResult &&
    message.kind === "message" &&
    (entry.creation_origin === "chat_attachment" ||
      ["image", "audio", "video", "file"].some((type) =>
        hasTiptapNodeType(entry.content, type),
      ));
  const responses = message.reply_count ?? entry?.reply_count ?? 0;
  const participants =
    message.reply_participants ?? entry?.reply_participants ?? [];
  if (event) {
    const destination =
      event.wall_id && room
        ? `/app/rooms/${room}/chat?wall=${event.wall_id}`
        : !event.wall_id
          ? appRoutes.round(event.id)
          : undefined;
    const occurred = parseTimestamp(event.occurred_at);
    const contents = (
      <View style={styles.eventContents}>
        <View style={layout.row}>
          <Text style={[styles.eventStatus, layout.grow]}>
            {event.event_label
              ?.replace(/\bActivity\b/g, "Round")
              .replace(/\bactivity\b/g, "round") ||
              (event.completed ? "Completed round" : "Round in progress")}
          </Text>
          {occurred && (
            <Text style={styles.eventTime}>
              {formatChatTimestamp(occurred)}
            </Text>
          )}
        </View>
        <View style={styles.eventBody}>
          <View style={layout.grow}>
            <Text
              accessibilityRole="header"
              aria-level={Platform.OS === "web" ? 2 : undefined}
              style={styles.title}
            >
              {event.name}
            </Text>
            {event.description && (
              <Text style={layout.text}>{event.description}</Text>
            )}
            {!event.wall_id && (
              <View style={styles.eventProgress}>
                <Text style={styles.eventTime}>
                  {event.submitted_count} of {event.participant_count}{" "}
                  submissions
                </Text>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${Math.min(100, (event.submitted_count / Math.max(1, event.participant_count)) * 100)}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            )}
          </View>
          {showDestinations && destination && (
            <Icon name="caretRight" size={24} color={tokens.roundEventAccent} />
          )}
        </View>
      </View>
    );
    return (
      <View>
        {showDestinations && destination ? (
          <Button
            emphasis="bare"
            accessibilityLabel={`View ${event.wall_id ? "wall" : "round"}: ${event.name}`}
            style={styles.event}
            onPress={() => {
              void links.open(destination);
            }}
          >
            {contents}
          </Button>
        ) : (
          <View style={styles.event}>{contents}</View>
        )}
        {links.error && (
          <Text accessibilityRole="alert" style={layout.text}>
            {links.error}
          </Text>
        )}
      </View>
    );
  }
  // The payload is the visible shared snapshot. Never fetch its private original.
  return (
    <View style={styles.content}>
      {entry && (attachment || activityResult) ? (
        <EntryContent entry={entry} />
      ) : message.content ? (
        <DocumentContent content={message.content} />
      ) : (
        <Text selectable={selectable} style={layout.text}>
          {message.body}
        </Text>
      )}
      {!entry && <LinkPreviewCard url={firstLinkPreviewUrl(message.content)} />}
      {entry && !entry.available && (
        <Text style={layout.muted}>The original entry is unavailable.</Text>
      )}
      {showDestinations && entry?.available && (
        <View onTouchStart={protectTouch}>
          {attachment ? (
            <ResponseSummary
              count={responses}
              participants={participants}
              onPress={() => {
                void links.open(appRoutes.entry(entry.id));
              }}
            />
          ) : (
            <Button
              emphasis="link"
              onPress={() => {
                void links.open(appRoutes.entry(entry.id));
              }}
            >
              {activityResult ? "Open entry" : "Open entry"}
            </Button>
          )}
        </View>
      )}
      {links.error && (
        <Text accessibilityRole="alert" style={layout.text}>
          {links.error}
        </Text>
      )}
    </View>
  );
}
export function ResponseSummary({
  compact = false,
  count,
  participants,
  onPress,
}: {
  compact?: boolean;
  count: number;
  participants: Array<{
    id: number;
    username: string;
    avatar_url?: string | null;
  }>;
  onPress: () => void;
}) {
  return (
    <Button
      emphasis="ghost"
      accessibilityLabel={`${count} ${compact ? (count === 1 ? "reply" : "replies") : count === 1 ? "response" : "responses"}. Open thread`}
      style={[styles.responses, compact && styles.compactResponses]}
      onPress={onPress}
    >
      <View style={[styles.responseRow, compact && styles.compactResponseRow]}>
        {count > 0 && (
          <View style={styles.participants}>
            {participants.slice(0, 3).map((person) => (
              <View key={person.id} style={styles.participant}>
                <UserAvatar
                  username={person.username}
                  avatarUrl={person.avatar_url}
                  size={compact ? 14 : 20}
                />
              </View>
            ))}
          </View>
        )}
        <Text
          style={[styles.responseLabel, compact && styles.compactResponseLabel]}
        >
          {count > 0
            ? `${count} ${compact ? (count === 1 ? "reply" : "replies") : count === 1 ? "response" : "responses"}`
            : "Reply"}
        </Text>
      </View>
    </Button>
  );
}
const styles = StyleSheet.create({
  compactResponses: {
    marginTop: 0,
    minHeight: 22,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  compactResponseRow: { gap: 3 },
  compactResponseLabel: { fontSize: 11, textDecorationLine: "none" },
  content: { gap: 6 },
  title: { fontFamily: "BarlowCondensedBold", fontSize: 23, color: tokens.ink },
  event: {
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: tokens.roundEventSurface,
    borderRadius: tokens.radius,
    alignItems: "stretch",
    borderWidth: 1,
    borderColor: tokens.roundEventBorder,
  },
  eventContents: { gap: 6 },
  eventBody: { flexDirection: "row", alignItems: "center", gap: 10 },
  eventStatus: {
    fontFamily: "LatoBold",
    fontSize: 11,
    textTransform: "uppercase",
    color: tokens.roundEventAccent,
  },
  eventTime: {
    fontFamily: "Lato",
    fontSize: 12,
    color: tokens.roundEventAccent,
  },
  eventProgress: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    backgroundColor: tokens.roundEventBorder,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: tokens.roundEventMuted },
  responses: {
    alignSelf: "flex-end",
    marginTop: 8,
    paddingHorizontal: 0,
    minHeight: Platform.OS === "android" ? 48 : 44,
  },
  responseRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  participants: { flexDirection: "row", paddingLeft: 6 },
  participant: {
    marginLeft: -6,
    borderWidth: 2,
    borderColor: tokens.paper,
    borderRadius: 12,
  },
  responseLabel: {
    fontFamily: "Lato",
    fontSize: 12,
    color: tokens.ink,
    textDecorationLine: "underline",
  },
});
