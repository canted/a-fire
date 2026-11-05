import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { IntroductionSummary } from "../../lib/api/introductions";
import { introductionContext } from "../../lib/introductionPresentation";
import { Button } from "../../components/Button";
import { ViewportShell } from "../../components/ViewportShell";
import { useMemberIntroductions } from "../../hooks/useMembers";
import { useIntroductionExposure } from "../../hooks/useIntroductionExposure";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { MemberProfileHeader } from "./MemberProfileHeader";
import { RoomWorkspace } from "../rooms/RoomWorkspace";
import { tokens } from "../../styles/tokens";
import { layout } from "../../styles/layout";
export function MemberIntroductionsScreen() {
  const { roomId, memberUserId, introduction: target } = useLocalSearchParams<{
    roomId: string;
    memberUserId: string;
    introduction?: string;
  }>();
  const { query, room: roomDetails, action, profilePath, hasMore, loadMore } = useMemberIntroductions({ roomId, memberUserId }, target);
  const navigation = useRoomNavigation();
  const scroll = useRef<ScrollView>(null);
  const positioned = useRef<string | undefined>(undefined);
  const data = !query.error && !roomDetails.error ? query.data : undefined;
  const positions = useRef(new Map<string, number>());
  useEffect(() => {
    if (!target || !data || positioned.current === target) return;
    const y = positions.current.get(target);
    if (y !== undefined) {
      positioned.current = target;
      scroll.current?.scrollTo({ y, animated: false });
    }
  }, [target, data]);
  const content = (
    <ScrollView
      ref={scroll}
      contentContainerStyle={[layout.content, styles.content]}
    >
      {query.isLoading && (
        <ActivityIndicator accessibilityLabel="Loading introductions" />
      )}
      {(query.error || roomDetails.error) && (
        <>
          <Text accessibilityRole="alert" style={layout.text}>
            Couldn’t load these introductions.
          </Text>
          <Button
            onPress={() => {
              void Promise.allSettled([query.mutate(), roomDetails.mutate()]);
            }}
          >
            Try again
          </Button>
        </>
      )}
      {data && (
        <>
          <MemberProfileHeader
            username={data.displayUsername || data.username}
            profileLine={data.profileLine}
            avatarUrl={data.displayAvatarUrl || data.avatarUrl}
            isCurrentUser={data.isCurrentUser}
            onEdit={() => navigation.destination("/app/profile")}
          />
          <Text accessibilityRole="header" style={styles.heading}>
            Introductions
          </Text>
          {!data.introductions.length && (
            <Text style={layout.muted}>No introductions yet.</Text>
          )}
          {data.introductions.map((item) => (
            <View
              key={item.id}
              onLayout={(event) => {
                positions.current.set(item.id, event.nativeEvent.layout.y);
                if (target === item.id && positioned.current !== target) {
                  positioned.current = target;
                  scroll.current?.scrollTo({
                    y: event.nativeEvent.layout.y,
                    animated: false,
                  });
                }
              }}
            >
              <IntroductionCard
                introduction={item}
                viewer={data.viewerUserId}
                run={(arg) => action.trigger(arg)}
              />
            </View>
          ))}
          {hasMore && <Button disabled={query.isValidating} onPress={() => { void loadMore().catch(() => {}); }}>Load older introductions</Button>}
        </>
      )}
    </ScrollView>
  );
  return data?.roomId ? (
    <RoomWorkspace
      roomId={data.roomId}
      room={roomDetails.data}
      backDestination={profilePath}
      backLabel="Back to profile"
    >
      {content}
    </RoomWorkspace>
  ) : (
    <ViewportShell>
      <Button onPress={() => navigation.ancestor(profilePath)}>
        Back to profile
      </Button>
      {content}
    </ViewportShell>
  );
}
function IntroductionCard({
  introduction,
  viewer,
  run,
}: {
  introduction: IntroductionSummary;
  viewer: string;
  run: (arg: { kind: "seen" | "retract"; id: string }) => Promise<unknown>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [seen, setSeen] = useState(false);
  const unseen =
    introduction.viewerIsRecipient && !introduction.viewerSeenAt && !seen;
  const ref = useIntroductionExposure(
    introduction.id,
    unseen
      ? () => {
          void run({ kind: "seen", id: introduction.id })
            .then(() => setSeen(true))
            .catch(() => setError("Couldn’t mark this introduction as read."));
        }
      : undefined,
  );
  return (
    <View
      ref={ref}
      style={styles.card}
      nativeID={`introduction-${introduction.id}`}
    >
      {unseen && <Text style={layout.muted}>New</Text>}
      <Text style={styles.context}>
        {introductionContext(introduction, viewer)}
      </Text>
      <Text style={styles.note}>“{introduction.note}”</Text>
      {introduction.canRetract && (
        <Button
          style={styles.retract}
          disabled={busy}
          color={tokens.danger}
          size="sm"
          emphasis="outline"
          onPress={() => {
            setError("");
            setBusy(true);
            void run({ kind: "retract", id: introduction.id })
              .catch(() => setError("Couldn’t retract this introduction."))
              .finally(() => setBusy(false));
          }}
        >
          Retract for everyone
        </Button>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={layout.text}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 12, paddingBottom: 32, gap: 16 },
  heading: {
    fontFamily: "PoppinsSemibold",
    fontSize: 18,
    lineHeight: 24,
    color: tokens.ink,
  },
  card: { gap: 8 },
  context: {
    fontFamily: "PoppinsSemibold",
    fontSize: 14,
    lineHeight: 20,
    color: tokens.ink,
  },
  note: { fontFamily: "Lato", fontSize: 14, lineHeight: 22, color: tokens.ink },
  retract: { alignSelf: "flex-start" },
});
