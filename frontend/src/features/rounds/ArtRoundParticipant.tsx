import { useRef, useState } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import type { RoundDetail } from "../../lib/api/rounds";
import { roundAction } from "../../lib/roundAction";
import { AppImage } from "../../components/AppImage";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { UserAvatar } from "../../components/UserAvatar";
import { EntryContent, EntryCoverCredit } from "../content/EntryContent";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";
import { ART_BEFORE_CHORUS_DESCRIPTION } from "../../../../types/activity-templates";

/** Participant presentation; mutations and authorization remain in useRound. */
export function ArtRoundParticipant({
  detail,
  busy,
  join,
  choose,
  contribute,
  allRounds,
}: {
  detail: RoundDetail;
  busy: boolean;
  join: () => void;
  choose: (id: string) => void;
  contribute: (kind: "cover" | "response") => void;
  allRounds: () => void;
}) {
  const [selected, setSelected] = useState<string>();
  const choiceRefs = useRef<Array<View | null>>([]);
  const { width, fontScale } = useWindowDimensions();
  const [resultsWidth, setResultsWidth] = useState(0);
  const columns = fontScale > 1.3 ? 1 : width < 540 ? 2 : 4;
  const state = detail.roundState!;
  const { cover, response, chosenCover, offeredCovers } = state.viewer;
  const joined =
    detail.viewerState.role === "participant" &&
    detail.viewerState.status === "active";
  const action = roundAction(detail);
  const due = (value?: string | null) =>
    value
      ? new Date(value).toLocaleString(undefined, {
          weekday: "long",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "the end of this phase";
  const heading = (title: string, description: string, completed = false) => (
    <View style={[styles.heading, completed && styles.status]}>
      {completed && (
        <View style={styles.check}>
          <Icon name="checkBold" size={28} color={tokens.paper} />
        </View>
      )}
      <View style={layout.grow}>
        <Text
          accessibilityRole="header"
          aria-level={Platform.OS === "web" ? 2 : undefined}
          style={[styles.title, { fontSize: width < 600 ? 28.8 : 39.2 }]}
        >
          {title}
        </Text>
        <Text style={layout.text}>{description}</Text>
      </View>
    </View>
  );
  if (state.phase === "complete")
    return (
      <View style={[styles.flow, styles.completed]}>
        <View style={styles.templateSection}>
          <Text style={styles.sectionLabel}>Round template</Text>
          <View style={styles.templateSummary}>
            <Text
              accessibilityRole="header"
              aria-level={Platform.OS === "web" ? 2 : undefined}
              style={styles.templateTitle}
            >
              The Art Before the Chorus
            </Text>
            <Text style={styles.recordText}>
              {ART_BEFORE_CHORUS_DESCRIPTION}
            </Text>
          </View>
        </View>
        {state.results.length ? (
          <View
            style={styles.resultGrid}
            onLayout={(event) =>
              setResultsWidth(event.nativeEvent.layout.width)
            }
          >
            {state.results.map(({ response: result, cover: source }) => (
              <View
                key={result.id}
                style={{
                  width: resultsWidth
                    ? (resultsWidth - 11 * (columns - 1)) / columns
                    : "100%",
                }}
              >
                <View style={[styles.response, styles.resultCard]}>
                  <View style={[styles.identity, styles.resultIdentity]}>
                    <UserAvatar
                      username={result.creatorName}
                      avatarUrl={result.avatarUrl}
                      size={32}
                    />
                    <Text
                      numberOfLines={1}
                      style={[styles.name, styles.resultName]}
                    >
                      {result.creatorName}
                    </Text>
                  </View>
                  <EntryContent
                    headingLevel={3}
                    showCoverCredit={false}
                    entry={{
                      room_statement: result.room_statement,
                      shared_feedback: result.shared_feedback,
                      content: result.content,
                      format: result.format,
                      format_data: result.formatData || null,
                    }}
                  />
                </View>
                <EntryCoverCredit
                  coverContributor={source.contributorName ?? "Anonymous"}
                  entry={{
                    room_statement: result.room_statement,
                      shared_feedback: result.shared_feedback,
                      content: result.content,
                    format: result.format,
                    format_data: result.formatData || null,
                  }}
                  style={styles.resultCredit}
                />
              </View>
            ))}
          </View>
        ) : (
          <Text style={layout.text}>
            No responses were received before this Round closed.
          </Text>
        )}
        <View style={styles.completionRecord}>
          <View
            style={[styles.recordRow, fontScale > 1.3 && styles.recordStack]}
          >
            <Text style={styles.recordText}>Round completed</Text>
            <Text
              style={[
                styles.recordText,
                styles.recordValue,
                fontScale > 1.3 && styles.recordValueStack,
              ]}
            >
              {due(detail.round.closedAt || detail.round.feedbackDueAt)}
            </Text>
          </View>
          <View
            style={[styles.recordRow, fontScale > 1.3 && styles.recordStack]}
          >
            <Text style={styles.recordText}>Participation</Text>
            <Text
              style={[
                styles.recordText,
                styles.recordValue,
                fontScale > 1.3 && styles.recordValueStack,
              ]}
            >
              {state.results.length} of {state.participants.length} participants
              responded
            </Text>
          </View>
          <Button style={styles.allRounds} emphasis="link" onPress={allRounds}>
            All rounds
          </Button>
        </View>
      </View>
    );
  if (!joined)
    return (
      <View style={styles.flow}>
        {heading(
          "The Art Before the Chorus",
          "Everyone contributes cover art, chooses from two images, and makes a small musical response.",
        )}
        {detail.round.prompt && (
          <Text style={layout.text}>{detail.round.prompt}</Text>
        )}
        <Text style={layout.text}>Covers: {due(detail.round.submitBy)}</Text>
        <Text style={layout.text}>
          Responses: {due(detail.round.feedbackDueAt)}
        </Text>
        {detail.viewerState.canJoin && (
          <Button disabled={busy} style={styles.target} onPress={join}>
            Join the round
          </Button>
        )}
      </View>
    );
  if (state.phase === "collecting_covers" && cover)
    return (
      <View style={styles.flow}>
        {heading(
          "Your cover is in",
          state.coverProgress.waitingPastSchedule
            ? `Waiting for ${state.coverProgress.remaining} more covers before everyone can choose between two.`
            : "Only you and the host can see it while other covers are being collected.",
          true,
        )}
        <View style={styles.artwork}>
          <AppImage
            src={cover.imageUrl}
            alt={cover.alt || "Your cover"}
            tiled
          />
        </View>
        <Button
          emphasis="link"
          disabled={busy}
          style={styles.target}
          onPress={() => contribute("cover")}
        >
          Replace cover
        </Button>
        <Text style={layout.text}>
          {state.coverProgress.waitingPastSchedule
            ? "You can change it while covers are still coming in."
            : `You can change it any time before ${due(detail.round.submitBy)}.`}
        </Text>
        <Text style={layout.text}>
          {state.coverProgress.submitted} covers submitted.{" "}
          {state.coverProgress.remaining > 0
            ? `${state.coverProgress.remaining} more needed before responses begin.`
            : "Waiting for the response phase."}
        </Text>
        <Text style={styles.waiting}>
          We’ll let you know when it’s time to choose between two covers.
        </Text>
      </View>
    );
  if (state.phase === "collecting_responses" && response)
    return (
      <View style={styles.flow}>
        {heading(
          "Your response is in",
          "It stays hidden with the cover until everyone’s work is revealed.",
          true,
        )}
        <View style={styles.response}>
          <View style={styles.identity}>
            <UserAvatar
              username={response.creatorName}
              avatarUrl={response.avatarUrl}
              size={32}
            />
            <Text style={styles.name}>{response.creatorName}</Text>
          </View>
          <EntryContent
            entry={{
              room_statement: response.room_statement,
                      shared_feedback: response.shared_feedback,
                      content: response.content,
              format: response.format,
              format_data: response.formatData || null,
            }}
          />
        </View>
        <View style={styles.replace}>
          <Button
            emphasis="link"
            disabled={busy}
            style={styles.target}
            onPress={() => contribute("response")}
          >
            Replace response
          </Button>
          <Text style={layout.text}>
            You can change it any time before{" "}
            {due(detail.round.feedbackDueAt)}.
          </Text>
        </View>
        <View style={[styles.waiting, styles.identity]}>
          <Icon name="checkBold" size={21} />
          <Text style={[layout.text, layout.grow]}>
            You’re done for now. We’ll let you know when the reveal opens.
          </Text>
        </View>
      </View>
    );
  if (state.phase === "collecting_responses" && !cover)
    return (
      <View style={styles.flow}>
        {heading(
          "The cover deadline has passed",
          "This Round is no longer accepting cover art.",
        )}
        <Text style={layout.text}>
          Ask the host whether they want to extend the cover phase for everyone.
        </Text>
      </View>
    );
  if (state.phase === "collecting_responses" && !chosenCover)
    return (
      <View style={styles.flow}>
        {heading(
          offeredCovers ? "Choose one cover" : "Preparing your cover choices",
          offeredCovers
            ? "Both came from other people in this Round. Pick the one that gives you somewhere to start."
            : "The third cover is in. Your two choices are being set up now.",
        )}
        {offeredCovers ? (
          <>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Choose a cover"
              style={[styles.choices, width < 600 && styles.stacked]}
            >
              {offeredCovers.map((item, index) => (
                <Button
                  key={item.id}
                  ref={(node) => {
                    choiceRefs.current[index] = node;
                  }}
                  onKeyDown={(event) => {
                    const key = event.nativeEvent.key;
                    if (
                      !busy &&
                      [
                        "ArrowLeft",
                        "ArrowUp",
                        "ArrowRight",
                        "ArrowDown",
                      ].includes(key)
                    ) {
                      event.preventDefault();
                      const next =
                        (index +
                          (key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1) +
                          offeredCovers.length) %
                        offeredCovers.length;
                      setSelected(offeredCovers[next].id);
                      choiceRefs.current[next]?.focus();
                    }
                  }}
                  accessibilityRole="radio"
                  checked={selected === item.id}
                  emphasis="bare"
                  disabled={busy}
                  style={styles.choice}
                  accessibilityLabel={`Choose cover ${index + 1}`}
                  onPress={() => setSelected(item.id)}
                >
                  <View style={styles.choiceImage}>
                    <AppImage
                      interactive={false}
                      src={item.imageUrl}
                      alt={item.alt || `Offered cover ${index + 1}`}
                      tiled
                    />
                  </View>
                  <View style={styles.choiceLabel}>
                    <View style={styles.radio}>
                      {selected === item.id && (
                        <View style={styles.radioSelected} />
                      )}
                    </View>
                    <Text style={layout.text}>
                      {selected === item.id ? "Chosen" : "Choose this cover"}
                    </Text>
                  </View>
                </Button>
              ))}
            </View>
            <Text style={layout.text}>
              The people who contributed these covers stay anonymous until the
              reveal.
            </Text>
            <Button
              disabled={busy || !selected}
              style={styles.target}
              onPress={() => {
                if (selected) choose(selected);
              }}
            >
              {busy ? "Choosing…" : "Use this cover"}
            </Button>
            <Text style={layout.text}>
              Choose a cover and submit your musical response by{" "}
              {due(detail.round.feedbackDueAt)}.
            </Text>
          </>
        ) : (
          <Text style={layout.text}>
            Return to this page in a moment to choose a cover and make your
            response.
          </Text>
        )}
      </View>
    );
  return (
    <View style={styles.flow}>
      {heading(
        chosenCover ? "Make your response" : "Share a cover",
        chosenCover
          ? `Start from your chosen cover. Share your response by ${due(detail.round.feedbackDueAt)}.`
          : `Share an image by ${due(detail.round.submitBy)}. Covers stay hidden while people are making.`,
      )}
      {detail.round.prompt && (
        <Text style={layout.text}>{detail.round.prompt}</Text>
      )}
      {chosenCover && (
        <View style={styles.artwork}>
          <AppImage
            src={chosenCover.imageUrl}
            alt={chosenCover.alt || "Chosen cover"}
            tiled
          />
        </View>
      )}
      {action && (action.kind === "cover" || action.kind === "response") && (
        <Button
          disabled={busy}
          style={styles.target}
          onPress={() => contribute(action.kind as "cover" | "response")}
        >
          {action.label}
        </Button>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  completed: { maxWidth: 896, gap: 32 },
  templateSection: { gap: 8 },
  sectionLabel: {
    fontFamily: "PoppinsSemibold",
    fontSize: 14,
    color: tokens.ink,
  },
  templateSummary: {
    padding: 16,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: tokens.radius,
    gap: 8,
  },
  templateTitle: {
    fontFamily: "PoppinsSemibold",
    fontSize: 20,
    lineHeight: 25,
    color: tokens.ink,
  },
  resultGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 11,
    rowGap: 24,
  },
  resultCard: { width: "100%", alignSelf: "stretch", padding: 4, gap: 4 },
  resultIdentity: { gap: 8 },
  resultName: { fontSize: 14 },
  resultCredit: {
    fontSize: 12,
    lineHeight: 15,
    paddingHorizontal: 6,
    paddingTop: 8,
  },
  completionRecord: {
    marginTop: 16,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: tokens.border,
    gap: 12,
  },
  recordRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  recordStack: { flexDirection: "column", gap: 4 },
  recordText: {
    fontFamily: "Lato",
    fontSize: 14,
    lineHeight: 21,
    color: tokens.ink,
  },
  recordValue: { maxWidth: "60%", textAlign: "right" },
  recordValueStack: { maxWidth: "100%", textAlign: "left" },
  allRounds: {
    minHeight: 48,
    minWidth: 48,
    marginTop: 20,
    alignSelf: "center",
  },
  flow: {
    width: "100%",
    maxWidth: 672,
    alignSelf: "center",
    gap: 24,
    paddingBottom: 48,
  },
  heading: {
    padding: 28,
    backgroundColor: tokens.paper,
    borderRadius: tokens.radius,
    gap: 8,
  },
  status: { flexDirection: "row", alignItems: "center", gap: 16 },
  title: { fontFamily: "PoppinsSemibold", color: tokens.ink },
  check: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: tokens.ink,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  artwork: {
    width: "100%",
    maxWidth: 320,
    aspectRatio: 1,
    alignSelf: "center",
    borderRadius: 16,
    overflow: "hidden",
  },
  response: {
    alignSelf: "center",
    maxWidth: "100%",
    padding: 12,
    gap: 8,
    backgroundColor: tokens.paper,
    borderRadius: 20,
  },
  identity: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { ...layout.text, fontFamily: "LatoBold", flexShrink: 1 },
  waiting: {
    ...layout.text,
    padding: 16,
    backgroundColor: tokens.surface,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: tokens.radius,
  },
  replace: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
  },
  choices: { flexDirection: "row", gap: 16 },
  stacked: { flexDirection: "column" },
  choice: {
    flex: 1,
    gap: 8,
    padding: 12,
    alignItems: "stretch",
    backgroundColor: tokens.paper,
  },
  choiceImage: { width: "100%", aspectRatio: 1 },
  choiceLabel: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    minHeight: 44,
  },
  radio: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: tokens.inkMuted,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: tokens.ink,
  },
  target: { minHeight: 48, minWidth: 48 },
});
