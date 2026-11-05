import { useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { ArtBeforeChorusRoundState } from "../../lib/api/rounds";
import { Button } from "../../components/Button";
import { AppImage } from "../../components/AppImage";
import { UserAvatar } from "../../components/UserAvatar";
import { Icon } from "../../components/Icon";
import { tokens } from "../../styles/tokens";
import { layout } from "../../styles/layout";

type Person = ArtBeforeChorusRoundState["participants"][number];
/** Active Art host dashboard; mutations stay with the existing Round owner. */
export function ArtRoundHost({
  state,
  due,
  busy,
  reminded,
  remind,
  remove,
}: {
  state: ArtBeforeChorusRoundState;
  due?: string | null;
  busy: boolean;
  reminded: Set<string>;
  remind: (user: string) => void;
  remove: (cover: string) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState(0);
  const gridGap = width <= 430 ? 8 : 16;
  const covers = state.phase === "collecting_covers";
  const submitted = state.participants.filter((person) =>
    covers ? person.hasCover : person.responseStatus === "submitted",
  );
  const waiting = state.participants.filter((person) =>
    covers ? !person.hasCover : person.responseStatus !== "submitted",
  );
  const identity = (person: Person, status: string) => (
    <>
      <UserAvatar
        username={person.name}
        avatarUrl={person.avatarUrl}
        size={28}
      />
      <View style={layout.grow}>
        <Text style={styles.name}>{person.name}</Text>
        <Text style={styles.meta}>{status}</Text>
      </View>
    </>
  );
  const heading = (title: string, count: string) => (
    <View style={layout.row}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      <Text style={styles.meta}>{count}</Text>
    </View>
  );
  return (
    <View style={styles.flow}>
      <View style={[styles.status, width <= 430 && { padding: 24 }]}>
        <Text
          accessibilityRole="header"
          style={[
            styles.title,
            {
              fontSize: Math.max(28.8, Math.min(39.2, width * 0.05)),
              lineHeight: Math.max(28.8, Math.min(39.2, width * 0.05)) * 1.15,
            },
          ]}
        >
          {covers ? "Covers coming in" : "Responses taking shape"}
        </Text>
        {(state.participants.length > 0 || !covers) && (
          <>
            <View style={[layout.row, styles.progressLabel]}>
              <Text style={styles.copy}>
                {covers ? "Covers" : "Responses"} added
              </Text>
              <Text style={styles.name}>
                {submitted.length} of {state.participants.length}
              </Text>
            </View>
            <View
              accessibilityRole="progressbar"
              accessibilityLabel={`${submitted.length} of ${state.participants.length} ${covers ? "covers" : "responses"} added`}
              accessibilityValue={{
                min: 0,
                max: state.participants.length,
                now: submitted.length,
              }}
              style={styles.progress}
            >
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${state.participants.length ? (submitted.length / state.participants.length) * 100 : 0}%`,
                  },
                ]}
              />
            </View>
          </>
        )}
        <Text style={[styles.copy, { marginTop: 8 }]}>
          {covers
            ? state.participants.length
              ? "Participants can see only their own cover."
              : "The round is open for participants to join and add a cover."
            : "Participants have their cover choices and are making their musical sketches."}
        </Text>
      </View>
      {covers && !state.participants.length && (
        <View>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            No one has joined yet
          </Text>
          <Text style={styles.copy}>
            The round view shows the invitation and Join Round button everyone
            sees from the Wall.
          </Text>
        </View>
      )}
      {covers && state.participants.length > 0 && (
        <View>
          {heading("Submitted covers", `${submitted.length} added`)}
          <View
            onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
            style={[styles.grid, { gap: gridGap }]}
          >
            {submitted
              .filter((person) => person.cover)
              .map((person) => (
                <View
                  key={person.id}
                  style={[
                    styles.card,
                    {
                      width:
                        fontScale > 1.3
                          ? gridWidth
                          : Math.max(0, (gridWidth - gridGap) / 2),
                    },
                  ]}
                >
                  <View style={styles.artwork}>
                    <AppImage
                      src={person.cover!.imageUrl}
                      alt={person.cover!.alt || "Cover"}
                      tiled
                    />
                  </View>
                  <View style={styles.person}>
                    {identity(person, "Cover added")}
                  </View>
                  <Button
                    emphasis="link"
                    size="sm"
                    accessibilityLabel={`Remove cover by ${person.name}`}
                    disabled={busy}
                    style={styles.remove}
                    onPress={() => remove(person.cover!.id)}
                  >
                    <Text style={styles.removeLabel}>Remove cover</Text>
                  </Button>
                </View>
              ))}
          </View>
        </View>
      )}
      {!covers && submitted.length > 0 && (
        <View>
          {heading("Responses in", `${submitted.length} added`)}
          <View style={styles.people}>
            {submitted.map((person) => (
              <View key={person.id} style={styles.person}>
                {identity(person, "Response added")}
                <Icon name="checkBold" size={18} color={tokens.ink} />
              </View>
            ))}
          </View>
        </View>
      )}
      {waiting.length > 0 && (
        <View>
          {heading(
            covers ? "Still choosing" : "Still making",
            String(waiting.length),
          )}
          <View style={styles.people}>
            {waiting.map((person) => (
              <View
                key={person.id}
                style={[styles.person, covers && styles.waiting]}
              >
                {identity(
                  person,
                  covers
                    ? "No cover yet"
                    : person.responseStatus === "making"
                      ? "Making a response"
                      : "Choosing a cover",
                )}
                <Button
                  emphasis="link"
                  color={tokens.coolStrong}
                  size="sm"
                  accessibilityLabel={
                    reminded.has(person.userId)
                      ? `Reminder sent to ${person.name}`
                      : `Remind ${person.name}`
                  }
                  disabled={busy || reminded.has(person.userId)}
                  onPress={() => remind(person.userId)}
                >
                  {reminded.has(person.userId) ? "Sent" : "Remind"}
                </Button>
              </View>
            ))}
          </View>
        </View>
      )}
      {covers ? (
        <View style={styles.phaseNote}>
          <Icon name="bell" size={21} />
          <Text style={[styles.copy, layout.grow]}>
            {due ? `This phase ends ${new Date(due).toLocaleString()}. ` : ""}
            Covers stay hidden from other participants until then.
          </Text>
        </View>
      ) : (
        <Text style={styles.copy}>
          {due
            ? `Responses are due ${new Date(due).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. `
            : ""}
          The shared reveal opens when this phase ends.
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  flow: { gap: 24 },
  status: {
    padding: 32,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: 3.2,
    backgroundColor: tokens.paper,
  },
  title: { color: tokens.ink, fontFamily: "PoppinsSemibold" },
  sectionTitle: {
    fontFamily: "PoppinsSemibold",
    fontSize: 18,
    color: tokens.ink,
  },
  copy: {
    fontFamily: "Lato",
    fontSize: 14,
    lineHeight: 21,
    color: tokens.inkMuted,
  },
  progressLabel: { marginTop: 24 },
  progress: {
    height: 12,
    marginTop: 8,
    borderRadius: 999,
    backgroundColor: tokens.surface,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: tokens.coolDarker },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 16 },
  card: {
    padding: 4,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: 3.2,
    backgroundColor: tokens.paper,
  },
  artwork: {
    width: "100%",
    aspectRatio: 1,
    borderWidth: 1,
    borderColor: tokens.border,
    overflow: "hidden",
  },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 52,
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  name: { fontFamily: "BarlowCondensedBold", fontSize: 18, color: tokens.ink },
  meta: { fontFamily: "Lato", fontSize: 12, color: tokens.inkMuted },
  people: { gap: 8, marginTop: 16 },
  waiting: {
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: 3.2,
    backgroundColor: tokens.paper,
  },
  remove: { alignSelf: "flex-start" },
  removeLabel: {
    fontFamily: "Lato",
    fontSize: 12,
    color: tokens.danger,
    textDecorationLine: "underline",
  },
  phaseNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: 3.2,
    backgroundColor: tokens.surface,
  },
});
