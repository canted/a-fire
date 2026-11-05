import { appRoutes } from "../../lib/appRoutes";
import { PageScrollView } from "../../components/PageScrollView";
import { roundTemplates } from "../../lib/roundTemplates";
import RoundDateFields from "./RoundDateFields";
import { RoomWorkspace } from "../rooms/RoomWorkspace";
import { useDraftNavigation } from "../../hooks/useDraftNavigation";
import { ViewportToolbar } from "../../components/ViewportToolbar";
import { tokens } from "../../styles/tokens";
import { Icon } from "../../components/Icon";
import { ART_BEFORE_CHORUS_MINIMUM_PARTICIPANTS } from "../../../../types/activity-templates";
import {
  isoToLocalDateTime,
  localDateTimeToIso,
} from "../../lib/roundDates";
import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import {
  Platform,
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { ViewportShell } from "../../components/ViewportShell";
import { useRound } from "../../hooks/useRounds";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import type {
  RoundSummary,
  RoundTemplateKey,
} from "../../lib/api/rounds";
import { layout } from "../../styles/layout";
export function RoundFormScreen() {
  const { roundId: activityId, templateKey, roomId } = useLocalSearchParams<{
    roomId?: string;
    roundId?: string;
    templateKey?: string;
  }>();
  const query = useRound(activityId, roomId);
  const navigation = useRoomNavigation();
  if (query.room.isLoading || (activityId && query.detail.isLoading))
    return (
      <ViewportShell>
        <ActivityIndicator accessibilityLabel="Loading Round form" />
      </ViewportShell>
    );
  if (query.room.error || (activityId && query.detail.error))
    return (
      <ViewportShell>
        <View style={[layout.content, layout.section]}>
          <Text style={layout.text}>Could not load this Round.</Text>
          <Button
            onPress={() => {
              void Promise.all([
                query.room.mutate(),
                query.detail.mutate(),
              ]).catch(() => {});
            }}
          >
            Retry
          </Button>
          <Button
            emphasis="ghost"
            accessibilityLabel="Back"
            onPress={() => navigation.returnTo()}
          >
            <Icon name="caretLeft" size={24} />
          </Button>
        </View>
      </ViewportShell>
    );
  if (
    !query.canManage ||
    (activityId &&
      !["draft", "active"].includes(
        query.detail.data?.round.status || "",
      )) ||
    (activityId &&
      query.detail.data?.round.status === "active" &&
      query.detail.data.phase === "complete")
  )
    return (
      <ViewportShell>
        <View style={[layout.content, layout.section]}>
          <Text style={layout.text}>Only hosts can edit an open Round.</Text>
          <Button
            emphasis="ghost"
            accessibilityLabel="Back"
            onPress={() => navigation.returnTo()}
          >
            <Icon name="caretLeft" size={24} />
          </Button>
        </View>
      </ViewportShell>
    );
  return (
    <RoundForm
      key={`${roomId}-${activityId || templateKey || "new"}`}
      query={query}
      template={templateKey}
    />
  );
}
function RoundForm({
  query,
  template,
}: {
  query: ReturnType<typeof useRound>;
  template?: string;
}) {
  const navigation = useRoomNavigation();
  const existing = query.detail.data?.round;
  const [kind, setKind] = useState<RoundTemplateKey | undefined>(
    existing?.templateKey ||
      (template === "feedback" || template === "art_before_chorus"
        ? template
        : undefined),
  );
  const [name, setName] = useState(
    existing?.name || `${query.room.data?.name || "Room"} Round`,
  );
  const [prompt, setPrompt] = useState(existing?.prompt || "");
  const [submitBy, setSubmitBy] = useState(
    isoToLocalDateTime(existing?.submitBy),
  );
  const [feedbackDueAt, setFeedbackDueAt] = useState(
    isoToLocalDateTime(existing?.feedbackDueAt),
  );
  const [responseFormat, setResponseFormat] = useState(
    String(existing?.templateConfig?.responseFormat || "audio_text"),
  );
  const [sketchSize, setSketchSize] = useState(
    String(existing?.templateConfig?.sketchSize || "tiny"),
  );
  const shortfall =
    kind === "art_before_chorus" && !existing
      ? Math.max(
          0,
          ART_BEFORE_CHORUS_MINIMUM_PARTICIPANTS -
            (query.members.data?.members.length ?? 0),
        )
      : 0;
  const [error, setError] = useState<string>();
  const guard = useDraftNavigation({
    dirty: false,
    busy: query.busy,
    busyMessage: "Wait for the Round to finish saving.",
    save: async () => {},
    onError: setError,
  });
  const dateValue = (value: string) => {
    if (!value.trim()) return null;
    const result = localDateTimeToIso(value);
    if (!result) throw new Error("Choose a valid date and time.");
    return result;
  };
  const submit = async () => {
    try {
      setError(undefined);
      const result = (await query.run({
        kind: "save",
        payload: {
          name: name.trim(),
          prompt: prompt.trim(),
          submitBy: dateValue(submitBy),
          feedbackDueAt: dateValue(feedbackDueAt),
          ...(!existing
            ? {
                templateKey: kind,
                ...(kind === "art_before_chorus"
                  ? { status: "active" as const }
                  : {}),
              }
            : {}),
          ...(kind === "art_before_chorus"
            ? {
                templateConfig: {
                  ...existing?.templateConfig,
                  responseFormat,
                  sketchSize,
                },
              }
            : {}),
        },
      })) as RoundSummary;
      guard.release();
      navigation.destination(
        appRoutes.round(result.id),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not save Round.",
      );
    }
  };
  const room = String(
    existing?.roomId ?? query.room.data?.id ?? "",
  );
  const back = existing
    ? appRoutes.round(existing.id)
    : `/app/rooms/${room}/rounds`;
  return (
    <RoomWorkspace
      roomId={room}
      room={query.room.data}
      denied={Boolean(query.room.error)}
      backDestination={back}
      backLabel={existing ? "Back to Round" : "Back to rounds"}
    >
      <PageScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content]}
      >
        <View style={kind ? styles.form : styles.chooser}>
          {!kind ? (
            <>
              <Text accessibilityRole="header" style={layout.title}>
                Choose a template
              </Text>
              <Text style={layout.muted}>
                Choose what everyone will do together. You’ll set the name,
                invitation, and timing next.
              </Text>
              {roundTemplates.map((item) => (
                <Button
                  key={item.id}
                  emphasis="bare"
                  style={styles.template}
                  onPress={() => setKind(item.id)}
                >
                  <View style={styles.templateIcon}>
                    {item.iconSequence.map((icon, index) => (
                      <View
                        key={icon}
                        style={[
                          styles.sequenceCard,
                          {
                            backgroundColor: tokens[item.cardColors[index]],
                            top: index ? 42 : 2,
                            left: index ? 7 : 1,
                            transform: [{ rotate: index ? "4deg" : "-5deg" }],
                          },
                        ]}
                      >
                        <Icon name={icon} size={24} color={tokens.paper} />
                      </View>
                    ))}
                  </View>
                  <View style={layout.grow}>
                    <Text style={layout.muted}>{item.category}</Text>
                    <Text style={styles.templateTitle}>{item.name}</Text>
                    <Text style={styles.templateDescription}>
                      {item.description}
                    </Text>
                    {item.minimumParticipants && (
                      <Text style={styles.templateDescription}>
                        At least {item.minimumParticipants} participants
                      </Text>
                    )}
                  </View>
                  <Icon name="arrowRight" size={22} />
                </Button>
              ))}
            </>
          ) : (
            <>
              <View style={styles.field}>
                <Text style={layout.muted}>Round name</Text>
                <Input
                  accessibilityLabel="Round name"
                  style={styles.input}
                  placeholder="Round name"
                  value={name}
                  editable={!query.busy}
                  onChangeText={setName}
                />
              </View>
              <View style={styles.field}>
                <Text style={layout.muted}>Prompt</Text>
                <Input
                  accessibilityLabel="Prompt"
                  style={styles.input}
                  placeholder="Prompt"
                  multiline
                  value={prompt}
                  editable={!query.busy}
                  onChangeText={setPrompt}
                />
              </View>
              <RoundDateFields
                submitBy={submitBy}
                feedbackDueAt={feedbackDueAt}
                disabled={query.busy}
                onChange={async (field, value) => {
                  if (field === "submitBy") setSubmitBy(value);
                  else setFeedbackDueAt(value);
                }}
                dom={{ matchContents: true, scrollEnabled: false }}
              />
              {kind === "art_before_chorus" && (
                <>
                  <Text
                    accessibilityRole="header"
                    aria-level={Platform.OS === "web" ? 2 : undefined}
                    style={layout.text}
                  >
                    Response format
                  </Text>
                  <View style={styles.wrap}>
                    {["audio_text", "audio", "any"].map((value) => (
                      <Button
                        style={styles.target}
                        key={value}
                        selected={responseFormat === value}
                        emphasis={responseFormat === value ? "solid" : "ghost"}
                        disabled={query.busy}
                        onPress={() => setResponseFormat(value)}
                      >
                        {value === "audio_text"
                          ? "Audio and text"
                          : value === "audio"
                            ? "Audio"
                            : "Any media"}
                      </Button>
                    ))}
                  </View>
                  <Text
                    accessibilityRole="header"
                    aria-level={Platform.OS === "web" ? 2 : undefined}
                    style={layout.text}
                  >
                    Sketch size
                  </Text>
                  <View style={styles.wrap}>
                    {["tiny", "small", "open"].map((value) => (
                      <Button
                        key={value}
                        style={styles.target}
                        selected={sketchSize === value}
                        emphasis={sketchSize === value ? "solid" : "ghost"}
                        disabled={query.busy}
                        onPress={() => setSketchSize(value)}
                      >
                        {value}
                      </Button>
                    ))}
                  </View>
                </>
              )}
              {shortfall > 0 && (
                <Text style={layout.text}>
                  Add {shortfall} more {shortfall === 1 ? "member" : "members"}{" "}
                  to this Room before opening this Round. Three participants are
                  needed so each person can choose between two covers.
                </Text>
              )}
              {error && (
                <Text accessibilityRole="alert" style={layout.text}>
                  {error}
                </Text>
              )}
            </>
          )}
        </View>
      </PageScrollView>
      {kind && (
        <ViewportToolbar>
          <View style={[layout.content, styles.actions]}>
            <Button
              shape="pill"
              disabled={query.busy || !name.trim() || shortfall > 0}
              onPress={() => {
                void submit();
              }}
            >
              {query.busy ? "Saving…" : existing ? "Save Round" : "Start Round"}
            </Button>
            <Button
              shape="pill"
              color={tokens.cool}
              disabled={query.busy}
              onPress={() => navigation.ancestor(back)}
            >
              Cancel
            </Button>
          </View>
        </ViewportToolbar>
      )}
    </RoomWorkspace>
  );
}
const styles = StyleSheet.create({
  chooser: { gap: 16 },
  template: {
    flexDirection: "row",
    gap: 16,
    padding: 16,
    backgroundColor: tokens.paper,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: tokens.radius,
  },
  templateIcon: { width: 52, height: 88 },
  sequenceCard: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  templateTitle: {
    fontFamily: "PoppinsSemibold",
    fontSize: 18,
    color: tokens.ink,
    marginVertical: 4,
  },
  templateDescription: {
    fontFamily: "Lato",
    fontSize: 14,
    lineHeight: 21,
    color: tokens.inkMuted,
  },
  content: { paddingTop: 16, paddingBottom: 16 },
  form: {
    gap: 20,
  },
  field: { gap: 6 },
  input: { backgroundColor: tokens.paper },
  actions: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    paddingTop: 8,
  },
  target: { minHeight: 48, minWidth: 48 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
