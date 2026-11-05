import { Button } from "../../components/Button";
import { UserIdentityName } from "../../components/UserIdentity";
import { MessageActions } from "./MessageActions";
import { MessageContent } from "./MessageContent";
import { formatChatTimestamp, parseTimestamp } from "../../lib/time";
import { RoomExposure } from "../../hooks/useRoomExposure";
import { memo, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import pattern from "../../lib/patternGenerator";
import type { RoomMessage } from "../../lib/api/room";
import type { VirtualMessageGroup } from "../../lib/messageGroups";
import { tokens } from "../../styles/tokens";
import { useIdentityImage } from "../../hooks/useIdentityImage";
export const MessageGroup = memo(function MessageGroup({
  group,
  last = false,
  room,
  canSaveMessage = false,
  showDestinations = true,
  rowPrefix = "chat",
  renderActions,
  headerAction,
  replySave,
  surface = "paper",
}: {
  surface?: "paper" | "surface";
  replySave?: { save(id: number): void; busy: boolean };
  renderActions?: (message: RoomMessage) => ReactNode;
  headerAction?: ReactNode;
  showDestinations?: boolean;
  rowPrefix?: string;
  room?: string;
  canSaveMessage?: boolean;
  last?: boolean;
  group: VirtualMessageGroup<RoomMessage>;
}) {
  const first = group.entries[0];
  const name =
    first.author?.display_username ||
    first.masked_author?.display_username ||
    "Room member";
  if (first.round_event)
    return (
      <MessageExposure id={first.id} group={group.key}>
        <MessageContent room={room} message={first} />
      </MessageExposure>
    );
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: tokens[surface] },
        group.continuation && styles.continuation,
        group.continues && styles.continues,
        last && { marginBottom: 0 },
      ]}
    >
      <AuthorStripe
        name={name}
        avatarUrl={first.author?.avatar_url}
        continuation={group.continuation}
        continues={group.continues}
      />
      <View style={styles.messages}>
        {group.entries.map((item, index) => (
          <MessageExposure
            prefix={rowPrefix}
            key={item.id}
            id={item.id}
            group={group.key}
          >
            {!group.continuation && index === 0 && (
              <View style={styles.header}>
                <Text style={styles.author}>{name}</Text>
                <Text style={styles.time}>
                  {parseTimestamp(item.created_at)
                    ? formatChatTimestamp(new Date(item.created_at))
                    : ""}
                </Text>
                {headerAction && <View style={styles.headerAction}>{headerAction}</View>}
              </View>
            )}
            {(canSaveMessage && room && item.kind === "message") || replySave ? (
              <MessageActions
                room={room}
                message={item}
                onSave={replySave ? () => replySave.save(item.id) : undefined}
                saveLabel={replySave ? "Save reply to source entry" : undefined}
                saveDisabled={replySave?.busy}
              >
                <MessageContent
                  room={room}
                  message={item}
                  showDestinations={showDestinations}
                />
              </MessageActions>
            ) : (
              <MessageContent
                room={room}
                message={item}
                showDestinations={showDestinations}
              />
            )}
            {renderActions?.(item)}
          </MessageExposure>
        ))}
      </View>
    </View>
  );
});
/** Shared author stripe for Chat, replies and feedback previews. */
export function AuthorStripe({
  size = "standard",
  name,
  avatarUrl,
  continuation,
  continues,
}: {
  name: string;
  size?: "standard" | "compact" | "savedReply";
  avatarUrl?: string | null;
  continuation?: boolean;
  continues?: boolean;
}) {
  const width = size === "compact" ? 12 : size === "savedReply" ? 19 : 20;
  const height = 1440 * (width / 20);
  const xml = useMemo(
    () => pattern(name.trim(), { width: 20, height: 1440 }),
    [name],
  );
  const uploaded = useIdentityImage(avatarUrl);
  const [failed, setFailed] = useState<string>();
  const source = uploaded && failed !== uploaded.uri ? uploaded : undefined;
  return (
    <View
      style={[
        styles.stripe,
        { width, borderRadius: width / 2 },
        continuation && styles.continuation,
        continues && styles.continues,
      ]}
      accessibilityLabel={`${name} avatar`}
    >
      {source || Platform.OS === "web" ? (
        <Image
          source={
            source || { uri: `data:image/svg+xml,${encodeURIComponent(xml)}` }
          }
          resizeMode="cover"
          style={
            source
              ? [StyleSheet.absoluteFill, styles.portrait]
              : [styles.stripeImage, { width, height }]
          }
          onError={() => source && setFailed(source.uri)}
        />
      ) : (
        <SvgXml
          style={styles.stripeImage}
          xml={xml}
          width={width}
          height={height}
        />
      )}
    </View>
  );
}
export function MessageExposure({
  id,
  group,
  children,
  prefix = "chat",
}: {
  prefix?: string;
  id: number;
  group: string;
  children: React.ReactNode;
}) {
  const register = useContext(RoomExposure);
  const ref = useCallback(
    (node: View | null) => register(id, node, group),
    [id, group, register],
  );
  return (
    <View ref={ref} collapsable={false} nativeID={`${prefix}-${id}`}>
      {children}
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    padding: 4,
    gap: 8,
    borderRadius: 20,
    marginBottom: 16,
  },
  continuation: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingTop: 0,
  },
  continues: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingBottom: 0,
    marginBottom: 0,
  },
  stripeImage: { position: "absolute", top: 0, left: 0 },
  portrait: {
    width: "100%",
    height: "100%",
    ...(Platform.OS === "web" ? { objectPosition: "top center" } : {}),
  },
  stripe: { width: 20, overflow: "hidden", borderRadius: 10 },
  messages: { flex: 1, paddingVertical: 4, gap: 8 },
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 7.2,
    marginBottom: 4.8,
  },
  headerAction: { marginLeft: "auto", alignSelf: "center" },
  author: {
    fontFamily: "BarlowCondensedBold",
    fontSize: 18.9,
    color: tokens.ink,
  },
  time: { fontFamily: "Lato", fontSize: 12, color: tokens.muted },
});

/** Compact saved-feedback preview shared by Wall history and Project timelines. */
export function SavedReplyPreview({ author, text, onPress, stripeSize = "compact" }: { author: string; text: string; onPress: () => void; stripeSize?: "compact" | "savedReply" }) {
  return <Button emphasis="bare" style={savedReplyStyles.button} accessibilityLabel={`Read ${author}'s feedback`} onPress={onPress}>
    <View style={savedReplyStyles.row}>
      <AuthorStripe name={author} size={stripeSize} />
      <Text style={savedReplyStyles.text} numberOfLines={2}>
        <UserIdentityName username={author} compact inline />{"\u2002"}{text}
      </Text>
    </View>
  </Button>;
}
const savedReplyStyles = StyleSheet.create({
  button: { minHeight: 0, padding: 4, paddingHorizontal: 4, paddingVertical: 4, alignItems: "stretch" },
  row: { flexDirection: "row", gap: 6, alignItems: "stretch" },
  text: { flex: 1, minWidth: 0, fontFamily: "Lato", fontSize: 12, lineHeight: 17, color: tokens.ink },
});
