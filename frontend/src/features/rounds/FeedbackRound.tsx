import { PageScrollView } from "../../components/PageScrollView";
import { useRef, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type {
  RoundDetail,
  RoundRole,
} from "../../lib/api/rounds";
import {
  activityParticipationStatus,
  activityTimeRemaining,
  completedActivitySummary,
  feedbackRoundPeople,
  canSubmitRoundEntry,
} from "../../lib/feedbackRoundPresentation";
import { formatChatTimestamp, parseTimestamp } from "../../lib/time";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { PopupMenu } from "../../components/PopupMenu";
import { UserAvatar } from "../../components/UserAvatar";
import { ViewportToolbar } from "../../components/ViewportToolbar";
import { EntryContent } from "../content/EntryContent";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";

type Props = {
  detail: RoundDetail;
  host: boolean;
  busy: boolean;
  reminded: Set<string>;
  error?: string;
  participate: (role?: RoundRole) => void;
  remind: (user?: string) => void;
  edit: () => void;
  start: () => void;
  archive: () => void;
  contribute: (mode: "new" | "project") => void;
  openEntry: (id: string) => void;
};
/** Feedback Round presentation shares state/copy with the active web owner. */
export function FeedbackRound({
  detail,
  host,
  busy,
  reminded,
  error,
  participate,
  remind,
  edit,
  start,
  archive,
  contribute,
  openEntry,
}: Props) {
  const [menu, setMenu] = useState(false),
    [options, setOptions] = useState(false);
  const participationAnchor = useRef<View>(null),
    optionsAnchor = useRef<View>(null);
  const { width, fontScale } = useWindowDimensions();
  const { round: round, viewerState: viewer } = detail;
  const open = round.status === "active" && detail.phase !== "complete";
  const canSubmit = viewer.canSubmit;
  const people = feedbackRoundPeople(detail);
  const time = activityTimeRemaining(detail.phase, round);
  const viewerSubmission = detail.submissions.find(
    (entry) => entry.entryId === viewer.submittedEntryId,
  );
  const groups =
    width < 360 || fontScale > 1.3
      ? people.entries.map((entry) => [entry])
      : people.submissionGroups;
  return (
    <>
      <PageScrollView contentContainerStyle={[]}>
        <View style={styles.banner}>
          <View style={layout.row}>
            <View style={[styles.inline, layout.grow]}>
              <Icon name="flagBanner" size={24} />
              <Text
                accessibilityRole="header"
                style={[styles.title, layout.grow]}
              >
                {round.name}
              </Text>
            </View>
            <View accessibilityLabel={time.description} style={styles.inline}>
              <Icon name="watch" size={18} />
              <Text style={styles.time}>{time.compact}</Text>
            </View>
            {host && open && (
              <Button
                ref={optionsAnchor}
                emphasis="bare"
                accessibilityLabel="Round options"
                hasPopup
                expanded={options}
                style={styles.icon}
                onPress={() => setOptions(true)}
              >
                <Icon name="dotsThree" size={24} />
              </Button>
            )}
          </View>
          {round.prompt && (
            <Text style={styles.prompt}>{round.prompt}</Text>
          )}
          {viewer.role === "reviewer" && (
            <Text style={layout.text}>
              You have given feedback to {detail.feedbackProgress.givenCount} of{" "}
              {detail.feedbackProgress.totalCount} submissions.
            </Text>
          )}
          {detail.phase === "complete" && (
            <Text style={layout.text}>
              {completedActivitySummary({
                role: viewer.role,
                submitted: Boolean(viewer.submittedEntryId),
                feedbackGivenCount: detail.feedbackProgress.givenCount,
                totalSubmissions: detail.feedbackProgress.totalCount,
                feedbackReceivedCount: viewerSubmission?.replyCount ?? 0,
                reviewedCount: detail.feedbackSummary.reviewedCount,
              })}
            </Text>
          )}
          {open && (
            <View style={[layout.row, styles.bannerActions]}>
              <Button
                ref={participationAnchor}
                emphasis="bare"
                hasPopup
                expanded={menu}
                accessibilityLabel={activityParticipationStatus(viewer.role)}
                style={styles.participation}
                onPress={() => setMenu(true)}
              >
                <Text style={styles.smallBold}>
                  {activityParticipationStatus(viewer.role)}
                </Text>
                <View style={styles.down}>
                  <Icon name="caretRight" size={14} />
                </View>
              </Button>
              {canSubmit && (
                <Button
                  emphasis="bare"
                  style={styles.compact}
                  disabled={busy}
                  onPress={() => contribute("project")}
                >
                  <Text style={styles.smallBold}>
                    {viewer.submittedEntryId
                      ? "Change submission"
                      : "Share from project"}
                  </Text>
                </Button>
              )}
            </View>
          )}
        </View>
        {host && (
          <View style={styles.owner}>
            <Text style={styles.count}>
              {detail.feedbackSummary.submittedCount}/{people.participantCount}{" "}
              submitted • {detail.feedbackSummary.reviewedCount}/
              {people.participantCount} reviewed
            </Text>
            <View style={styles.inline}>
              {["submission", "feedback"].includes(detail.phase) && (
                <Button
                  emphasis="link"
                  disabled={busy}
                  style={styles.compact}
                  onPress={() => remind()}
                >
                  <Text style={styles.link}>
                    {detail.phase === "submission"
                      ? "Remind people to submit"
                      : "Remind people to give feedback"}
                  </Text>
                </Button>
              )}
              {(round.status === "draft" || open) && (
                <Button emphasis="link" style={styles.compact} onPress={edit}>
                  <Text style={styles.link}>edit round</Text>
                </Button>
              )}
              {round.status === "draft" && (
                <Button disabled={busy} shape="pill" onPress={start}>
                  Start Round
                </Button>
              )}
            </View>
          </View>
        )}
        {error && (
          <Text accessibilityRole="alert" style={layout.text}>
            {error}
          </Text>
        )}
        <View style={styles.submissions}>
          <View style={layout.row}>
            <Text accessibilityRole="header" style={styles.heading}>
              Submissions
            </Text>
            <Text style={styles.count}>
              {detail.submissions.length} of {people.participantCount}
            </Text>
          </View>
          {!people.participantCount && (
            <Text style={layout.text}>
              No participants have joined this Round yet.
            </Text>
          )}
          {groups.map((group, index) => (
            <View key={index} style={styles.group}>
              {group.map((entry) => {
                const person =
                  entry.kind === "submission"
                    ? entry.submission
                    : entry.participant;
                const submittedAt =
                  entry.kind === "submission"
                    ? parseTimestamp(entry.submission.submittedAt)
                    : null;
                return (
                  <View key={person.id} style={styles.column}>
                    <View style={styles.person}>
                      <UserAvatar
                        username={person.displayUsername}
                        avatarUrl={person.avatarUrl}
                        size={25}
                      />
                      <Text
                        numberOfLines={1}
                        style={[styles.personName, layout.grow]}
                      >
                        {person.displayUsername}
                      </Text>
                      {submittedAt && (
                        <Text style={styles.date}>
                          {formatChatTimestamp(submittedAt)}
                        </Text>
                      )}
                    </View>
                    {entry.kind === "submission" ? (
                      <>
                        <Button
                          emphasis="bare"
                          accessibilityLabel={`Open submission by ${person.displayUsername}`}
                          style={styles.entry}
                          onPress={() => openEntry(entry.submission.entryId)}
                        >
                          <View pointerEvents="none" style={{ width: "100%" }}>
                            <EntryContent
                              interactive={false}
                              entry={{
                                room_statement: entry.submission.room_statement,
                  shared_feedback: entry.submission.shared_feedback,
                  content: entry.submission.content,
                                format: entry.submission.format,
                                format_data:
                                  entry.submission.formatData ?? null,
                              }}
                            />
                          </View>
                        </Button>
                        {detail.phase === "feedback" &&
                          !entry.submission.replyCount && (
                            <Text style={styles.smallBold}>Needs feedback</Text>
                          )}
                        <Button
                          emphasis="bare"
                          accessibilityLabel={`${entry.submission.replyCount} ${entry.submission.replyCount === 1 ? "reply" : "replies"}. Open submission`}
                          style={styles.replies}
                          onPress={() => openEntry(entry.submission.entryId)}
                        >
                          <Text style={styles.replyLabel}>
                            {entry.submission.replyCount}{" "}
                            {entry.submission.replyCount === 1
                              ? "reply"
                              : "replies"}
                          </Text>
                          <Icon name="caretRight" size={18} />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Text style={layout.text}>has not submitted yet</Text>
                        {canSubmitRoundEntry(detail, person.userId) && (
                            <Button
                              shape="pill"
                              onPress={() => contribute("new")}
                            >
                              Share
                            </Button>
                          )}
                        {host && (
                          <Button
                            emphasis="link"
                            style={styles.remind}
                            disabled={busy || reminded.has(person.userId)}
                            onPress={() => remind(person.userId)}
                          >
                            <Text style={styles.link}>
                              {reminded.has(person.userId)
                                ? "Reminder sent"
                                : "Remind to submit"}
                            </Text>
                          </Button>
                        )}
                      </>
                    )}
                  </View>
                );
              })}
              {group.length === 1 && width >= 360 && fontScale <= 1.3 && (
                <View style={styles.column} />
              )}
            </View>
          ))}
          <View style={styles.people}>
            {[
              { title: "Reviewers", list: detail.reviewers },
              { title: "Followers", list: detail.followers },
            ].map(({ title, list }) => (
              <View key={title} style={styles.column}>
                <Text accessibilityRole="header" style={styles.heading}>
                  {title}
                </Text>
                {list.filter((person) => person.status === "active").length ? (
                  list
                    .filter((person) => person.status === "active")
                    .map((person) => (
                      <View key={person.id} style={styles.inline}>
                        <UserAvatar
                          username={person.displayUsername}
                          avatarUrl={person.avatarUrl}
                          size={24}
                        />
                        <Text style={layout.text}>
                          {person.displayUsername}
                        </Text>
                      </View>
                    ))
                ) : (
                  <Text style={layout.text}>None</Text>
                )}
              </View>
            ))}
          </View>
        </View>
      </PageScrollView>
      {canSubmit && (
        <ViewportToolbar>
          <View style={styles.fabRow}>
            <Button
              emphasis="bare"
              accessibilityLabel="Share something"
              style={styles.fab}
              onPress={() => contribute("new")}
            >
              <Icon name="plus" size={30} />
            </Button>
          </View>
        </ViewportToolbar>
      )}
      <PopupMenu
        mode="menu"
        open={menu}
        title="Participation"
        anchor={participationAnchor}
        onClose={() => setMenu(false)}
        actions={[
          ...(viewer.canJoin && viewer.role !== "participant"
            ? [
                {
                  id: "participant",
                  label: "Join Round",
                  onSelect: () => {
                    setMenu(false);
                    participate("participant");
                  },
                },
              ]
            : []),
          ...(viewer.canReview && viewer.role !== "reviewer"
            ? [
                {
                  id: "reviewer",
                  label: "Review only",
                  onSelect: () => {
                    setMenu(false);
                    participate("reviewer");
                  },
                },
              ]
            : []),
          ...(viewer.canFollow && viewer.role !== "follower"
            ? [
                {
                  id: "follower",
                  label: "Follow only",
                  onSelect: () => {
                    setMenu(false);
                    participate("follower");
                  },
                },
              ]
            : []),
          ...(viewer.role
            ? [
                {
                  id: "leave",
                  label: "Leave Round",
                  onSelect: () => {
                    setMenu(false);
                    participate();
                  },
                },
              ]
            : []),
        ].map((action) => ({ ...action, disabled: busy || !open }))}
      />
      <PopupMenu
        mode="menu"
        open={options}
        title="Round options"
        anchor={optionsAnchor}
        onClose={() => setOptions(false)}
        actions={[
          {
            id: "archive",
            label: "Archive round",
            disabled: busy,
            onSelect: () => {
              setOptions(false);
              archive();
            },
          },
        ]}
      />
    </>
  );
}
const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: 24,
    paddingTop: 14.4,
    paddingBottom: 16,
    backgroundColor: tokens.coolPale,
    gap: 10,
  },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  title: { fontFamily: "BarlowCondensedBold", fontSize: 20, color: tokens.ink },
  time: { fontFamily: "BarlowCondensedSemibold", fontSize: 16, color: tokens.ink },
  prompt: {
    fontFamily: "Lato",
    fontSize: 14,
    lineHeight: 21,
    color: tokens.ink,
  },
  bannerActions: { flexWrap: "wrap", gap: 8 },
  participation: {
    flexDirection: "row",
    gap: 4,
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: "#f1fafb",
    borderRadius: 999,
  },
  down: { transform: [{ rotate: "90deg" }] },
  smallBold: { fontFamily: "LatoBold", fontSize: 14, color: tokens.ink },
  icon: { width: 24, minHeight: 24, paddingHorizontal: 0, paddingVertical: 0 },
  compact: { minHeight: 24, paddingHorizontal: 0, paddingVertical: 0 },
  owner: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: tokens.surfaceMuted,
  },
  count: { fontFamily: "PoppinsSemibold", fontSize: 14, color: tokens.ink },
  link: {
    fontFamily: "LatoBold",
    fontSize: 14,
    textDecorationLine: "underline",
    color: tokens.ink,
  },
  submissions: { padding: 16, gap: 18 },
  heading: { fontFamily: "PoppinsSemibold", fontSize: 20, color: tokens.ink },
  group: { flexDirection: "row", gap: 16 },
  column: { flex: 1, minWidth: 0, gap: 6 },
  person: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 28 },
  personName: { fontFamily: "BarlowCondensedBold", fontSize: 16, color: tokens.ink },
  date: { fontFamily: "BarlowCondensedSemibold", fontSize: 12, color: tokens.inkMuted },
  entry: {
    backgroundColor: tokens.paper,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 0,
    alignItems: "stretch",
  },
  replies: {
    alignSelf: "flex-end",
    flexDirection: "row",
    gap: 6,
    minHeight: 24,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  replyLabel: { fontFamily: "LatoBold", fontSize: 12, color: tokens.ink },
  remind: {
    alignSelf: "flex-start",
    minHeight: 24,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  people: {
    flexDirection: "row",
    gap: 16,
    borderTopWidth: 1,
    borderTopColor: tokens.border,
    paddingTop: 16,
  },
  fabRow: { alignItems: "flex-end", paddingTop: 16, paddingHorizontal: 16 },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: tokens.projectEntryAction,
  },
});
