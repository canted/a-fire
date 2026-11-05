import { appRoutes } from "../../lib/appRoutes";
import { useRef } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { ViewportShell } from "../../components/ViewportShell";
import {
  RoundContribution,
  EntryContributionEditor,
} from "../rounds/RoundContribution";
import { useEntryDraft } from "../../hooks/useEntryDraft";
import { useRoundDetail } from "../../hooks/useRounds";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { layout } from "../../styles/layout";

export function EntryComposerScreen() {
  const { draftId, roundId: activityId, origin } =
    useLocalSearchParams<{
      draftId?: string;
      roundId?: string;
      origin?: string;
    }>();
  const query = useEntryDraft({
    existing: draftId,

    round: activityId,
    origin: origin === "chat" ? "chat" : undefined,
  });
  const round = useRoundDetail(
    query.draft.data?.round_id
      ? String(query.draft.data.round_id)
      : undefined,
  );
  const navigation = useRoomNavigation();
  const router = useRouter();
  const published = useRef<number | undefined>(undefined);
  if (!draftId)
    return (
      <ViewportShell>
        <View style={[layout.content, layout.section]}>
          <Text style={layout.text}>Open a room to create an entry.</Text>
          <Button onPress={() => navigation.home()}>Back to Home</Button>
        </View>
      </ViewportShell>
    );
  if (
    query.draft.isLoading ||
    (query.draft.data?.round_id && round.isLoading)
  )
    return (
      <ViewportShell>
        <ActivityIndicator accessibilityLabel="Opening entry" />
      </ViewportShell>
    );
  if (query.draft.error || round.error)
    return (
      <ViewportShell>
        <View style={[layout.content, layout.section]}>
          <Text accessibilityRole="alert" style={layout.text}>
            Couldn’t open this draft.
          </Text>
          <Button
            onPress={() => {
              void Promise.all([query.draft.mutate(), round.mutate()]).catch(
                () => {},
              );
            }}
          >
            Try again
          </Button>
          <Button emphasis="link" onPress={() => navigation.returnTo()}>
            Back
          </Button>
        </View>
      </ViewportShell>
    );
  if (query.draft.data && !query.draft.data.source_entry_id) return (
    <ViewportShell><View style={[layout.content, layout.section]}>
      <Text accessibilityRole="alert" style={layout.text}>This older draft has no private source entry. It is retained, but cannot be shared until its project association is explicitly recovered.</Text>
      <Button onPress={() => navigation.returnTo(query.draft.data?.room_id ? `/app/rooms/${query.draft.data.room_id}` : "/app")}>Back to Room</Button>
      {query.draft.data.room_id && <Button emphasis="link" onPress={() => router.replace(`/app/rooms/${query.draft.data!.room_id}/new-entry`)}>Start a project-backed entry</Button>}
    </View></ViewportShell>
  );
  if (query.draft.data?.round_id && round.data) {
    const origin = query.draft.data.creation_origin;
    return (
      <RoundContribution
        detail={round.data}
        kind={
          origin === "round_activity_cover"
            ? "cover"
            : origin === "round_activity_response"
              ? "response"
              : "submission"
        }
        existingDraft={String(query.draft.data.id)}
        initialMode="new"
        done={() =>
          router.replace(
            appRoutes.round(round.data!.round.id),
          )
        }
      />
    );
  }
  return (
    <EntryContributionEditor
      query={{
        ...query,
        submit: async (persist) => {
          const result = await query.submit(persist);
          published.current = result.id;
        },
      }}
      done={() => {
        if (published.current) router.replace(`/app/entries/${published.current}`);
        else
          navigation.returnTo(
            query.draft.data?.room_id
              ? `/app/rooms/${query.draft.data.room_id}`
              : "/app",
          );
      }}
    />
  );
}
