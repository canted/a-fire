import { useRoomParticipation } from "../../hooks/useRoomParticipation";
import { useRoomHistory } from "../../hooks/useRoomHistory";
import { appRoutes } from "../../lib/appRoutes";
import { PageScrollView } from "../../components/PageScrollView";
import { AuthorStripe } from "../rooms/MessageGroup";
import { ResponseSummary } from "../rooms/MessageContent";
import { tokens } from "../../styles/tokens";
import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { AppImage } from "../../components/AppImage";
import { RoomWorkspace } from "../rooms/RoomWorkspace";
import { EntryContent } from "../content/EntryContent";
import { DocumentContent } from "../content/DocumentContent";
import { useRoomRounds, useRoundDetail } from "../../hooks/useRounds";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import {
  currentActivityActions,
  activityWaitingMessage,
} from "../../lib/roundActions";
import { roomRoundsModel } from "../../lib/roomRoundsModel";
import type { RoundSummary } from "../../lib/api/rounds";
import { layout } from "../../styles/layout";

export function RoomRoundsScreen({
  view = "overview",
}: {
  view?: "overview" | "participation" | "history";
}) {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const query = useRoomRounds(roomId, true, view === "overview");
  const navigation = useRoomNavigation();
  const [actionCounts, setActionCounts] = useState<Record<string, number>>({});
  const reportActions = useCallback(
    (id: string, count: number) =>
      setActionCounts((value) =>
        value[id] === count ? value : { ...value, [id]: count },
      ),
    [],
  );
  const roomDetails = query.room.error ? undefined : query.room.data;
  const participation = Boolean(
    roomDetails &&
    (roomDetails.access?.can_participate_rounds ??
      roomDetails.access?.kind !== "visitor"),
  );
  const { current, contributions: overviewContributions, history: overviewHistory } = roomRoundsModel(
    query.rounds.data,
    roomId,
    participation,
  );
  const historyAllowed = Boolean(roomDetails && (participation || roomDetails.porosity === "open"));
  const historyQuery = useRoomHistory(roomId, view === "history" && historyAllowed ? (participation ? "member" : "visitor") : undefined);
  const history = view === "history" ? historyQuery.items : overviewHistory;
  const participationQuery = useRoomParticipation(roomId, view === "participation" && participation);
  const contributions = view === "participation" ? participationQuery.items : overviewContributions;
  const loading = query.room.isLoading || (view === "history" ? historyQuery.query.isLoading : view === "participation" ? participationQuery.query.isLoading : query.rounds.isLoading);
  const roundsError = view === "overview" && query.rounds.error;
  const allowed = Boolean(roomDetails && !loading && !roundsError);
  return (
    <RoomWorkspace
      roomId={roomId}
      room={query.room.data}
      denied={Boolean(query.room.error)}
    >
      <PageScrollView contentContainerStyle={[styles.content]}>
        {loading && <ActivityIndicator accessibilityLabel="Loading Rounds" />}
        {(query.room.error || roundsError) && (
          <>
            <Text accessibilityRole="alert" style={layout.text}>
              Could not load Rounds.
            </Text>
            <Button
              style={styles.target}
              onPress={() => {
                void Promise.all([
                  query.room.mutate(),
                  query.rounds.mutate(),
                ]).catch(() => {});
              }}
            >
              Retry Rounds
            </Button>
          </>
        )}
        {allowed && view === "history" && !historyAllowed && (
          <Text style={layout.text}>Room history is unavailable during this visit.</Text>
        )}
        {allowed && view === "participation" && !participation && <Text style={layout.text}>Participation history is available to Room members.</Text>}
        {allowed && (
          <>
            {view === "overview" ? (
              <View style={styles.section}>
                <Text accessibilityRole="header" style={styles.heading}>
                  Current rounds
                </Text>
                {current.length > 1 && (
                  <Text style={layout.muted}>
                    This Room has several ongoing rounds from before the
                    one-round limit. Complete them before starting another
                    round, or use a side room.
                  </Text>
                )}
                {[...current]
                  .sort(
                    (a, b) =>
                      Number((actionCounts[b.id] ?? 0) > 0) -
                      Number((actionCounts[a.id] ?? 0) > 0),
                  )
                  .map((round) => (
                    <CurrentRound
                      key={round.id}
                      round={round}
                      participation={participation}
                      reportActions={reportActions}
                    />
                  ))}
                {!current.length && (
                  <>
                    <Text style={layout.muted}>
                      No current rounds. Chat is open whenever you want to
                      connect.
                    </Text>
                    {roomDetails?.access?.can_manage && (
                      <Button
                        style={styles.target}
                        onPress={() =>
                          navigation.destination(
                            `/app/rooms/${roomId}/rounds/new`,
                          )
                        }
                      >
                        Start round
                      </Button>
                    )}
                  </>
                )}
              </View>
            ) : (
              <Button
                style={styles.target}
                emphasis="link"
                onPress={() =>
                  navigation.ancestor(`/app/rooms/${roomId}/rounds`)
                }
              >
                Back to rounds
              </Button>
            )}
            {participation && view !== "history" && (
              <View style={styles.section}>
                <Text accessibilityRole="header" style={styles.heading}>
                  Your participation
                </Text>
                {(view === "participation"
                  ? contributions
                  : contributions.slice(0, 3)
                ).map(({ round: round, contribution }) => (
                  <Participation
                    key={`${round.id}-${contribution.kind}-${contribution.replyId ?? contribution.entryId}`}
                    round={round}
                    contribution={contribution}
                  />
                ))}
                {!contributions.length && !participationQuery.query.error && (
                  <Text style={layout.muted}>
                    Your shared work, choices, and feedback will appear here as you
                    take part.
                  </Text>
                )}
                {view === "participation" && participationQuery.query.error && <>
                  <Text accessibilityRole="alert" style={layout.text}>Could not load your participation.</Text>
                  <Button onPress={() => { void participationQuery.query.mutate().catch(() => {}); }}>Retry participation</Button>
                </>}
                {view === "participation" && participationQuery.hasMore && <Button disabled={participationQuery.query.isValidating} onPress={() => { void participationQuery.query.setSize(size => size + 1).catch(() => {}); }}>
                  {participationQuery.query.isValidating ? "Loading participation…" : "Load older participation"}
                </Button>}
                {view === "overview" && (
                  <Button
                    style={styles.target}
                    emphasis="outline"
                    shape="pill"
                    onPress={() =>
                      navigation.destination(
                        `/app/rooms/${roomId}/participation`,
                      )
                    }
                  >
                    View all your participation
                  </Button>
                )}
              </View>
            )}
            {historyAllowed && view !== "participation" && (
              <View style={styles.section}>
                <Text accessibilityRole="header" style={styles.heading}>
                  Recently in this Room
                </Text>
                <View style={styles.historyList}>
                  {(view === "history" ? history : history.slice(0, 3)).map(
                    (event) => (
                      <View key={event.id} style={styles.history}>
                        {event.roundId ? (
                          <View style={styles.referenceLine}>
                            <RoundReference
                              round={{
                                id: event.roundId,
                                cover: "cover" in event ? event.cover : null,
                                name:
                                  [
                                    ...(query.rounds.data?.currentRounds ??
                                      []),
                                    ...(query.rounds.data?.recentRounds ??
                                      []),
                                  ].find((item) => item.id === event.roundId)
                                    ?.name ??
                                  event.label.replace(/ completed$/, ""),
                              }}
                            />
                            <Text style={layout.text}>completed</Text>
                          </View>
                        ) : (
                          <Text style={layout.text}>{event.label}</Text>
                        )}
                        {event.occurredAt && (
                          <Text style={layout.muted}>
                            {new Date(event.occurredAt).toLocaleDateString(
                              undefined,
                              {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              },
                            )}
                          </Text>
                        )}
                      </View>
                    ),
                  )}
                </View>
                {!history.length && !historyQuery.query.error && (
                  <Text style={layout.muted}>
                    Room milestones will appear here.
                  </Text>
                )}
                {view === "history" && historyQuery.query.error && (
                  <>
                    <Text accessibilityRole="alert" style={layout.text}>Could not load Room history.</Text>
                    <Button onPress={() => { void historyQuery.query.mutate().catch(() => {}); }}>Retry history</Button>
                  </>
                )}
                {view === "history" && historyQuery.hasMore && (
                  <Button disabled={historyQuery.query.isValidating} onPress={() => { void historyQuery.query.setSize(size => size + 1).catch(() => {}); }}>
                    {historyQuery.query.isValidating ? "Loading history…" : "Load older history"}
                  </Button>
                )}
                {view === "overview" && (
                  <Button
                    style={styles.target}
                    emphasis="outline"
                    shape="pill"
                    onPress={() =>
                      navigation.destination(`/app/rooms/${roomId}/history`)
                    }
                  >
                    View Room history
                  </Button>
                )}
              </View>
            )}
          </>
        )}
      </PageScrollView>
    </RoomWorkspace>
  );
}
export function CurrentRound({
  round,
  participation,
  reportActions,
  compact = false,
}: {
  compact?: boolean;
  round: RoundSummary;
  participation: boolean;
  reportActions: (id: string, count: number) => void;
}) {
  const query = useRoundDetail(round.id);
  const navigation = useRoomNavigation();
  const detail = query.error ? undefined : query.data;
  const actions = participation ? currentActivityActions(detail) : [];
  useEffect(() => {
    reportActions(round.id, actions.length);
  }, [round.id, actions.length, reportActions]);
  const cover =
    detail?.roundState?.viewer.chosenCover ??
    detail?.roundState?.viewer.cover;
  const open = () =>
    navigation.destination(
      appRoutes.round(round.id),
    );
  if (compact) return <Button emphasis="bare" style={styles.compactRound} onPress={open}>
    <Text numberOfLines={1} style={styles.compactRoundName}>{round.name}</Text>
    <Text numberOfLines={2} style={layout.muted}>{query.error ? "Could not load next step · Open round" : query.isLoading ? "Loading next step…" : actions.map(action => action.label).join(" · ") || activityWaitingMessage(detail)}</Text>
  </Button>;
  return (
    <View style={styles.current}>
      {!compact && cover && (
        <View style={styles.cover}>
          <AppImage
            src={cover.imageUrl}
            alt={cover.alt || "Chosen cover"}
            tiled
          />
        </View>
      )}
      <View style={styles.currentCopy}>
        <Button emphasis="bare" style={styles.roundTitleButton} onPress={open}>
          <Text style={styles.roundTitle}>{round.name}</Text>
        </Button>
        {!compact && round.prompt && <Text style={layout.text}>{round.prompt}</Text>}
      </View>
      <View style={styles.currentActions}>
        {query.isLoading ? (
          <Text style={styles.state}>Loading your next step…</Text>
        ) : query.error ? (
          <Text accessibilityRole="alert" style={styles.state}>
            Could not load your next step. Open the Round to try again.
          </Text>
        ) : (
          <>
            {actions.map((action) => (
              <Button
                key={action.label}
                shape="pill"
                style={styles.activityAction}
                onPress={open}
              >
                {action.label}
              </Button>
            ))}
            {!actions.length && (
              <Text style={styles.state}>{activityWaitingMessage(detail)}</Text>
            )}
          </>
        )}
      </View>
    </View>
  );
}
function Participation({
  round,
  contribution,
}: {
  round: Pick<RoundSummary, "id" | "name" | "cover">;
  contribution: NonNullable<RoundSummary["viewerContributions"]>[number];
}) {
  const navigation = useRoomNavigation();
  const preview = contribution.preview;
  const entry = preview?.entry;
  const reply = preview?.replies.find(item => String(item.id) === contribution.replyId);
  const recipient = entry?.user.display_username || entry?.user.username;
  const label =
    contribution.kind === "reply"
      ? recipient
        ? `You gave feedback to ${recipient}`
        : "You gave feedback"
      : contribution.kind === "choice"
        ? "You chose this image"
        : "You shared something";
  const open = () =>
    navigation.destination(
      `/app/entries/${contribution.entryId}${contribution.replyId ? `#reply-${contribution.replyId}` : ""}`,
    );
  const participants = (preview?.participants ?? []).map(user => ({ id: user.id, username: user.display_username || user.username, avatar_url: user.display_avatar_url ?? user.avatar_url }));
  return (
    <View style={contribution.kind === "reply" && styles.feedbackCard}>
      <View style={styles.participationHeading}>
        <Button emphasis="bare" style={styles.labelButton} onPress={open}>
          <Text style={styles.participationLabel}>{label} in</Text>
        </Button>
        <RoundReference round={round} />
      </View>
      {contribution.kind === "reply" ? (
        <View style={styles.feedback}>
          {reply?.content ? (
            <>
              <AuthorStripe
                name={
                  reply.user?.display_username ||
                  reply.user?.username ||
                  "You"
                }
                avatarUrl={
                  reply.user?.display_avatar_url ??
                  reply.user?.avatar_url
                }
              />
              <View style={layout.grow}>
                <DocumentContent content={reply.content} />
              </View>
            </>
          ) : (
            <Button emphasis="link" onPress={open}>
              Read your feedback
            </Button>
          )}
        </View>
      ) : entry ? (
        <View style={styles.entryCard}>
          <Button
            emphasis="bare"
            accessibilityLabel={`Your shared work in ${round.name}`}
            style={styles.entry}
            onPress={open}
          >
            <View pointerEvents="none" style={{ width: "100%" }}>
              <EntryContent
                interactive={false}
                preview
                entry={{
                  room_statement: entry.room_statement,
                  shared_feedback: entry.shared_feedback,
                  content: entry.content,
                  format: entry.format,
                  format_data: entry.format_data ?? null,
                }}
              />
            </View>
          </Button>
          {Boolean(contribution.replyCount) && (
            <ResponseSummary
              count={contribution.replyCount!}
              participants={participants}
              onPress={open}
            />
          )}
        </View>
      ) : (
        <Text style={styles.state}>
          Open to see your shared work.
        </Text>
      )}
      {contribution.kind === "reply" && Boolean(contribution.replyCount) && (
        <ResponseSummary
          count={contribution.replyCount!}
          participants={participants}
          onPress={open}
        />
      )}
    </View>
  );
}
export function RoomParticipationScreen() {
  return <RoomRoundsScreen view="participation" />;
}
export function RoomHistoryScreen() {
  return <RoomRoundsScreen view="history" />;
}
function RoundReference({
  round,
}: {
  round: Pick<RoundSummary, "id" | "name" | "cover">;
}) {
  const navigation = useRoomNavigation();
  const cover = round.cover;
  return (
    <Button
      emphasis="bare"
      style={styles.chip}
      onPress={() =>
        navigation.destination(
          appRoutes.round(round.id),
        )
      }
    >
      {cover ? (
        <View style={styles.chipImage}>
          <AppImage src={cover.imageUrl} alt="" tiled />
        </View>
      ) : null}
      <Text numberOfLines={1} style={styles.chipLabel}>
        {round.name}
      </Text>
    </Button>
  );
}
const styles = StyleSheet.create({
  compactRound: { alignItems: "flex-start", gap: 2, paddingVertical: 6 },
  compactRoundName: { fontFamily: "LatoBold", fontSize: 13, color: tokens.ink },
  content: { paddingTop: 56, paddingBottom: 102, gap: 48 },
  section: { gap: 8 },
  heading: { color: tokens.ink, fontFamily: "PoppinsSemibold", fontSize: 18 },
  target: { minHeight: 48, minWidth: 48, alignSelf: "flex-start" },
  current: {
    overflow: "hidden",
    backgroundColor: tokens.paper,
    borderRadius: 12,
  },
  cover: { aspectRatio: 2, maxHeight: 320 },
  currentCopy: { padding: 16, gap: 8 },
  roundTitleButton: {
    alignItems: "flex-start",
    paddingHorizontal: 0,
    paddingVertical: 0,
    minHeight: 24,
  },
  roundTitle: {
    fontFamily: "PoppinsSemibold",
    fontSize: 20,
    lineHeight: 24,
    color: tokens.ink,
  },
  activityAction: { minHeight: 36, paddingHorizontal: 14, paddingVertical: 0 },
  currentActions: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    alignItems: "flex-start",
    gap: 8,
  },
  state: { color: tokens.muted, fontFamily: "Lato", fontSize: 14 },
  historyList: {
    backgroundColor: tokens.paper,
    borderRadius: 12,
    paddingHorizontal: 16,
    overflow: "hidden",
  },
  history: {
    paddingVertical: 8,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border,
  },
  referenceLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    gap: 5,
    maxWidth: "100%",
    minHeight: 34,
    paddingVertical: 4,
    paddingHorizontal: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: tokens.border,
    backgroundColor: tokens.paper,
  },
  chipImage: { width: 24, height: 24, overflow: "hidden", borderRadius: 3 },
  chipLabel: {
    flexShrink: 1,
    fontFamily: "BarlowCondensedSemibold",
    fontSize: 18,
    color: tokens.ink,
  },
  participationHeading: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    paddingTop: 16,
    paddingBottom: 8,
  },
  participationLabel: {
    fontFamily: "LatoBold",
    fontSize: 15,
    color: tokens.ink,
  },
  labelButton: { paddingHorizontal: 0, paddingVertical: 0, minHeight: 34 },
  feedbackCard: {
    backgroundColor: tokens.paper,
    borderRadius: tokens.radius,
    paddingHorizontal: 16,
  },
  feedback: { flexDirection: "row", gap: 10, paddingBottom: 16 },
  entryCard: {
    backgroundColor: tokens.paper,
    borderRadius: 20,
    overflow: "hidden",
    padding: 4,
  },
  entry: {
    minHeight: 36,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: "hidden",
    width: "100%",
    backgroundColor: tokens.paper,
    borderRadius: 16,
  },
});
