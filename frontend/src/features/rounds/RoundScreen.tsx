import { Toast } from "../../components/Toast";
import { appRoutes } from "../../lib/appRoutes";
import { PageScrollView } from "../../components/PageScrollView";
import { Checkbox } from "../../components/Checkbox";
import { PopupMenu } from "../../components/PopupMenu";
import { useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Platform,
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { AppImage } from "../../components/AppImage";
import { ViewportShell } from "../../components/ViewportShell";
import { DocumentContent } from "../content/DocumentContent";
import { EntryContent } from "../content/EntryContent";
import { FeedbackRound } from "./FeedbackRound";
import { RoomWorkspace } from "../rooms/RoomWorkspace";
import { RoundContribution } from "./RoundContribution";
import { ArtRoundParticipant } from "./ArtRoundParticipant";
import { ArtRoundHost } from "./ArtRoundHost";
import { Icon } from "../../components/Icon";
import { useRound } from "../../hooks/useRounds";
import { useRoundContributionNavigation } from "../../hooks/useRoundContributionNavigation";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { roundAction } from "../../lib/roundAction";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";
export function RoundScreen() {
  const { roundId: activityId, view } = useLocalSearchParams<{
    roundId: string;
    view?: string;
  }>();
  return (
    <RoundDetail
      key={activityId}
      roundId={activityId}
      manage={view === "manage"}
    />
  );
}
function RoundDetail({
  roundId: activityId,
  manage,
}: {
  roundId: string;
  manage: boolean;
}) {
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const query = useRound(activityId);
  const navigation = useRoomNavigation();
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const contributionNavigation = useRoundContributionNavigation();
  const { kind: contribution, mode: contributionMode } = contributionNavigation;
  const [confirmClose, setConfirmClose] = useState(false);
  const removalAnchor = useRef<View>(null);
  const [remove, setRemove] = useState<string>();
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [reminded, setReminded] = useState<Set<string>>(() => new Set());
  const detail =
    !query.detail.error ? query.detail.data : undefined;
  const round = detail?.round;
  const state = detail?.roundState;
  const host = query.canManage;
  const active = round?.status === "active" && detail?.phase !== "complete";
  const artHostView = Boolean(state && host && active && manage);
  const participantView = Boolean(
    state &&
    (active || state.phase === "complete") &&
    !(host && manage && active),
  );
  const action = detail ? roundAction(detail) : null;
  const run = async (value: Parameters<typeof query.run>[0]) => {
    setError(undefined);
    setFeedback(undefined);
    try {
      const result = await query.run(value);
      if (value.kind === "remind-person")
        setReminded((current) => new Set(current).add(value.user));
      setFeedback(
        result && typeof result === "object" && "sent" in result
          ? `Sent ${result.sent} reminders.`
          : "Saved.",
      );
      setRemove(undefined);
      setConfirmClose(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not update this Round. Try again.",
      );
    }
  };
  if (contribution && detail && query.room.data?.access?.can_participate_rounds && !query.room.error)
    return (
      <RoundContribution
        detail={detail}
        kind={contribution}
        initialMode={contributionMode}
        done={() => {
          contributionNavigation.close();
          void query.detail.mutate().catch(() => {});
        }}
      />
    );
  const roomRecord = round?.roomId;
  if (detail && round && !state && roomRecord)
    return (
      <RoomWorkspace
        roomId={String(roomRecord)}
        room={query.room.data}
        denied={Boolean(query.room.error)}
        backDestination={`/app/rooms/${roomRecord}/rounds`}
        backLabel="Back to rounds"
      >
        <FeedbackRound
          detail={detail}
          host={Boolean(host)}
          busy={query.busy}
          reminded={reminded}
          error={error}
          participate={(role) => {
            void run(
              role ? { kind: "participate", role } : { kind: "withdraw" },
            );
          }}
          remind={(user) => {
            void run(
              user ? { kind: "remind-person", user } : { kind: "remind" },
            );
          }}
          edit={() =>
            navigation.destination(
              appRoutes.roundEdit(activityId),
            )
          }
          start={() => {
            void run({ kind: "start" });
          }}
          archive={() => {
            void run({ kind: "archive" });
          }}
          contribute={(mode) => {
            contributionNavigation.open("submission", mode);
          }}
          openEntry={(id) => navigation.destination(`/app/entries/${id}`)}
        />
      <Toast message={feedback} onDismiss={() => setFeedback(undefined)} />
      </RoomWorkspace>
    );
  return (
    <ViewportShell>
      <PageScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.page]}
      >
        <View
          style={[layout.row, styles.header, largeText && styles.largeHeader]}
        >
          <View
            style={[
              layout.row,
              layout.grow,
              largeText && styles.largeHeaderMain,
            ]}
          >
            <Button
              size="icon"
              accessibilityLabel="Back"
              style={styles.target}
              emphasis="ghost"
              disabled={query.busy}
              onPress={() =>
                navigation.returnTo(
                  round?.roomId
                    ? `/app/rooms/${round.roomId}/rounds`
                    : "/app",
                )
              }
            >
              <Icon name="caretCircleLeft" size={24} />
            </Button>
            <Text
              accessibilityRole="header"
              aria-level={Platform.OS === "web" ? 1 : undefined}
              numberOfLines={1}
              ellipsizeMode="tail"
              style={layout.appBarTitle}
            >
              {round?.name || "Round"}
            </Text>
          </View>
          {state && active && host && (
            <Button
              style={styles.target}
              emphasis="link"
              color={tokens.coolStrong}
              disabled={query.busy}
              onPress={() =>
                router.setParams({ view: manage ? undefined : "manage" })
              }
            >
              {manage ? "View Round" : "Manage Round"}
            </Button>
          )}
        </View>
        {(query.detail.isLoading) && (
          <ActivityIndicator accessibilityLabel="Loading Round" />
        )}
        {(query.detail.error) && (
          <>
            <Text accessibilityRole="alert" style={layout.text}>
              This Round is unavailable or you no longer have access.
            </Text>
            <Button
              style={styles.target}
              onPress={() => {
                void Promise.all([
                  query.detail.mutate(),
                ]).catch(() => {});
              }}
            >
              Retry Round
            </Button>
          </>
        )}
        {detail && participantView ? (
          <>
            {error && (
              <Text accessibilityRole="alert" style={layout.text}>
                {error}
              </Text>
            )}
            <ArtRoundParticipant
              detail={detail}
              busy={query.busy}
              join={() => {
                void run({ kind: "participate", role: "participant" });
              }}
              choose={(cover) => {
                void run({ kind: "choose", cover });
              }}
              contribute={contributionNavigation.open}
              allRounds={() =>
                navigation.destination(
                  `/app/rooms/${round?.roomId}/rounds`,
                )
              }
            />
          </>
        ) : (
          detail &&
          round && (
            <>
              {artHostView ? (
                <View>
                  <Text style={styles.templateName}>
                    The Art Before the Chorus
                  </Text>
                  <Button
                    emphasis="link"
                    color={tokens.coolStrong}
                    style={styles.edit}
                    onPress={() =>
                      navigation.destination(
                        appRoutes.roundEdit(activityId),
                      )
                    }
                  >
                    Edit round
                  </Button>
                </View>
              ) : (
                <>
                  <Text style={layout.text}>{round.prompt}</Text>
                  <Text style={layout.muted}>
                    {round.status === "draft"
                      ? "Draft"
                      : state?.phase.replaceAll("_", " ") || detail.phase}{" "}
                    · {round.status}
                  </Text>
                  {round.submitBy && (
                    <Text style={layout.muted}>
                      Submissions:{" "}
                      {new Date(round.submitBy).toLocaleString()}
                    </Text>
                  )}
                  {round.feedbackDueAt && (
                    <Text style={layout.muted}>
                      Responses:{" "}
                      {new Date(round.feedbackDueAt).toLocaleString()}
                    </Text>
                  )}
                </>
              )}
              {error && (
                <Text accessibilityRole="alert" style={layout.text}>
                  {error}
                </Text>
              )}
              {active && !state && (
                <View style={styles.wrap}>
                  {detail.viewerState.canJoin &&
                    detail.viewerState.role !== "participant" && (
                      <Button
                        style={styles.target}
                        disabled={query.busy}
                        onPress={() => {
                          void run({
                            kind: "participate",
                            role: "participant",
                          });
                        }}
                      >
                        Join the round
                      </Button>
                    )}
                  {detail.viewerState.canReview &&
                    detail.viewerState.role !== "reviewer" && (
                      <Button
                        style={styles.target}
                        disabled={query.busy}
                        onPress={() => {
                          void run({ kind: "participate", role: "reviewer" });
                        }}
                      >
                        Join as reviewer
                      </Button>
                    )}
                  {detail.viewerState.canFollow &&
                    detail.viewerState.role !== "follower" && (
                      <Button
                        style={styles.target}
                        disabled={query.busy}
                        onPress={() => {
                          void run({ kind: "participate", role: "follower" });
                        }}
                      >
                        Follow round
                      </Button>
                    )}
                  {detail.viewerState.role &&
                    detail.viewerState.status === "active" && (
                      <Button
                        style={styles.target}
                        emphasis="link"
                        disabled={query.busy}
                        onPress={() => {
                          void run({ kind: "withdraw" });
                        }}
                      >
                        Withdraw participation
                      </Button>
                    )}
                </View>
              )}
              {active && !state && (
                <>
                  {action &&
                    ["cover", "response", "submission"].includes(
                      action.kind,
                    ) && (
                      <Button
                        style={styles.target}
                        disabled={query.busy}
                        onPress={() =>
                          contributionNavigation.open(
                            action.kind as "cover" | "response" | "submission",
                          )
                        }
                      >
                        {action.label}
                      </Button>
                    )}
                </>
              )}
              {state && host && active ? (
                <ArtRoundHost
                  state={state}
                  due={
                    state.phase === "collecting_covers"
                      ? round.submitBy
                      : round.feedbackDueAt
                  }
                  busy={query.busy}
                  reminded={reminded}
                  remind={(user) => {
                    void run({ kind: "remind-person", user });
                  }}
                  remove={(cover) => {
                    setRemove(cover);
                    setNote("");
                    setNotify(true);
                  }}
                />
              ) : (
                <>
                  {state?.phase === "collecting_covers" && (
                    <Text style={layout.muted}>
                      {state.coverProgress.submitted} covers submitted.{" "}
                      {state.coverProgress.remaining > 0
                        ? `${state.coverProgress.remaining} more needed before responses begin.`
                        : "Waiting for the response phase."}
                    </Text>
                  )}
                  <Text
                    accessibilityRole="header"
                    aria-level={Platform.OS === "web" ? 2 : undefined}
                    style={layout.title}
                  >
                    Participants
                  </Text>
                  {(state?.participants || detail.participants).map(
                    (person) => {
                      const name =
                        "name" in person ? person.name : person.displayUsername;
                      const cover =
                        "cover" in person ? person.cover : undefined;
                      return (
                        <View key={person.id} style={layout.section}>
                          <Text style={layout.text}>
                            {name}
                            {"status" in person ? ` · ${person.status}` : ""}
                          </Text>
                          {host &&
                            active &&
                            (!("status" in person) ||
                              person.status === "active") &&
                            !(
                              "submittedEntryId" in person &&
                              person.submittedEntryId
                            ) &&
                            !(
                              state?.phase === "collecting_responses" &&
                              "responseStatus" in person &&
                              person.responseStatus === "submitted"
                            ) &&
                            !(
                              state?.phase === "collecting_covers" && cover
                            ) && (
                              <Button
                                style={styles.target}
                                emphasis="link"
                                disabled={
                                  query.busy || reminded.has(person.userId)
                                }
                                onPress={() => {
                                  void run({
                                    kind: "remind-person",
                                    user: person.userId,
                                  });
                                }}
                              >
                                {reminded.has(person.userId)
                                  ? `Reminder sent to ${name}`
                                  : `Remind ${name}`}
                              </Button>
                            )}
                          {host &&
                            active &&
                            state?.phase === "collecting_covers" &&
                            cover && (
                              <>
                                <View style={styles.cover}>
                                  <AppImage
                                    src={cover.imageUrl}
                                    alt={cover.alt || "Cover"}
                                    tiled
                                  />
                                </View>
                                <Button
                                  ref={
                                    remove === cover.id
                                      ? removalAnchor
                                      : undefined
                                  }
                                  accessibilityLabel={`Remove cover by ${name}`}
                                  style={styles.target}
                                  emphasis="link"
                                  onPress={() => {
                                    setRemove(cover.id);
                                    setNote("");
                                    setNotify(true);
                                  }}
                                >
                                  Remove cover
                                </Button>
                              </>
                            )}
                        </View>
                      );
                    },
                  )}
                </>
              )}

              {[
                { title: "Reviewers", people: detail.reviewers },
                { title: "Followers", people: detail.followers },
              ].map(({ title, people }) => {
                const activePeople = people.filter(
                  (person) => person.status === "active",
                );
                return activePeople.length ? (
                  <View key={title} style={layout.section}>
                    <Text
                      accessibilityRole="header"
                      aria-level={Platform.OS === "web" ? 2 : undefined}
                      style={layout.title}
                    >
                      {title}
                    </Text>
                    {activePeople.map((person) => (
                      <Text key={person.id} style={layout.text}>
                        {person.displayUsername}
                      </Text>
                    ))}
                  </View>
                ) : null;
              })}
              {detail.submissions.length > 0 && (
                <Text
                  accessibilityRole="header"
                  aria-level={Platform.OS === "web" ? 2 : undefined}
                  style={layout.title}
                >
                  Shared work
                </Text>
              )}
              {detail.submissions.map((entry) => (
                <View key={entry.id} style={layout.section}>
                  <Text style={layout.text}>{entry.displayUsername}</Text>
                  <EntryContent
                    entry={{
                      room_statement: entry.room_statement,
                  shared_feedback: entry.shared_feedback,
                  content: entry.content,
                      format: entry.format,
                      format_data: entry.formatData || null,
                    }}
                  />
                  <Button
                    style={styles.target}
                    emphasis="link"
                    onPress={() =>
                      navigation.destination(`/app/entries/${entry.entryId}`)
                    }
                  >
                    {entry.replyCount
                      ? `${entry.replyCount} responses`
                      : "Respond"}
                  </Button>
                </View>
              ))}
              {state?.results.map((result) => (
                <View key={result.response.id} style={layout.section}>
                  <View style={styles.cover}>
                    <AppImage
                      src={result.cover.imageUrl}
                      alt={result.cover.alt || "Cover"}
                      tiled
                    />
                  </View>
                  <Text style={layout.text}>{result.response.creatorName}</Text>
                  <DocumentContent content={result.response.content} />
                  <Button
                    style={styles.target}
                    emphasis="link"
                    onPress={() =>
                      navigation.destination(
                        `/app/entries/${result.response.entryId}`,
                      )
                    }
                  >
                    Open response
                  </Button>
                </View>
              ))}
              {host && !artHostView && (
                <View style={layout.section}>
                  {(round.status === "draft" || active) && (
                    <Button
                      style={styles.target}
                      emphasis="link"
                      onPress={() =>
                        navigation.destination(
                          appRoutes.roundEdit(activityId),
                        )
                      }
                    >
                      Edit Round
                    </Button>
                  )}
                  {round.status === "draft" && (
                    <Button
                      style={styles.target}
                      disabled={query.busy}
                      onPress={() => {
                        void run({ kind: "start" });
                      }}
                    >
                      Start Round
                    </Button>
                  )}
                  {active && (
                    <>
                      <Button
                        style={styles.target}
                        emphasis="link"
                        disabled={query.busy}
                        onPress={() => {
                          void run({ kind: "remind" });
                        }}
                      >
                        Remind current phase
                      </Button>
                      {confirmClose ? (
                        <>
                          <Text style={layout.text}>
                            Complete this Round and publish its Wall?
                          </Text>
                          <Button
                            style={styles.target}
                            disabled={query.busy}
                            onPress={() => {
                              void run({ kind: "archive" });
                            }}
                          >
                            Confirm complete Round
                          </Button>
                          <Button
                            style={styles.target}
                            emphasis="ghost"
                            onPress={() => setConfirmClose(false)}
                          >
                            Keep Round open
                          </Button>
                        </>
                      ) : (
                        <Button
                          style={styles.target}
                          emphasis="link"
                          onPress={() => setConfirmClose(true)}
                        >
                          Complete Round
                        </Button>
                      )}
                    </>
                  )}
                </View>
              )}
            </>
          )
        )}
      </PageScrollView>
      <PopupMenu
        mode="dialog"
        open={Boolean(remove)}
        title="Remove cover"
        width={480}
        anchor={removalAnchor}
        onClose={() => {
          if (!query.busy) setRemove(undefined);
        }}
        actions={[]}
        footer={
          <View style={styles.removalActions}>
            <Button
              size="sm"
              emphasis="link"
              accessibilityLabel="Cancel removal"
              disabled={query.busy}
              onPress={() => setRemove(undefined)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              shape="pill"
              color={tokens.danger}
              accessibilityLabel="Confirm remove cover"
              disabled={query.busy}
              onPress={() => {
                if (remove)
                  void run({ kind: "remove", artifact: remove, note, notify });
              }}
            >
              <Text style={styles.removeLabel}>
                {query.busy ? "Removing…" : "Remove cover"}
              </Text>
            </Button>
          </View>
        }
      >
        <View style={layout.section}>
          <Text style={layout.text}>
            They’ll need to add another cover before they can continue in this
            Round.
          </Text>
          <Text style={layout.text}>Note about the removal · Optional</Text>
          <Input
            multiline
            maxLength={500}
            accessibilityLabel="Cover removal note"
            placeholder="Why was this cover removed?"
            value={note}
            editable={!query.busy}
            onChangeText={setNote}
          />
          <Checkbox
            label="Send notification"
            checked={notify}
            disabled={query.busy}
            onChange={setNotify}
          />
          {error && (
            <Text accessibilityRole="alert" style={layout.text}>
              {error}
            </Text>
          )}
        </View>
      </PopupMenu>
    <Toast message={feedback} onDismiss={() => setFeedback(undefined)} />
    </ViewportShell>
  );
}
const styles = StyleSheet.create({
  templateName: {
    fontFamily: "PoppinsSemibold",
    fontSize: 14,
    color: tokens.ink,
  },
  edit: { alignSelf: "flex-start", paddingHorizontal: 0 },
  removalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    padding: 12,
  },
  removeLabel: { fontFamily: "Lato", fontSize: 14, color: tokens.paper },
  largeHeader: { flexDirection: "column", alignItems: "stretch" },
  largeHeaderMain: { flex: 0, width: "100%" },
  page: { gap: 24, paddingBottom: 48 },
  header: {
    minHeight: 48,
  },
  headerTitle: { fontSize: 18, fontFamily: "BarlowCondensedBold" },
  target: { minHeight: 48, minWidth: 48 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cover: { height: 220 },
});
