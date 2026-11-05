import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SWRConfig, unstable_serialize } from "swr";
import { CurrentRound } from "./RoomRoundsScreen";
import { StoryNavigation } from "../../../.storybook/navigationFixture";
import type { RoundDetail } from "../../lib/api/rounds";
import { normalizeFeedbackRequest } from "../../lib/feedback";
import { layout } from "../../styles/layout";

export default { title: "Expo/Rooms/Current Round", component: CurrentRound };
const text = (value: string) => ({ type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text: value }] }] });
function feedback(): RoundDetail {
  return {
    round: { id: "1", roomId: "1", hostId: "1", name: "Small hours", prompt: "Bring a work in progress and listen for what it needs next.", status: "active", templateKey: "feedback", feedbackRequest: normalizeFeedbackRequest() },
    phase: "submission", viewerState: { role: null, status: null, canJoin: true, canReview: false, canFollow: true, canSubmit: false },
    participants: [], reviewers: [], followers: [], submissions: [],
    feedbackSummary: { submittedCount: 0, reviewedCount: 0, replyCount: 0 }, feedbackProgress: { givenCount: 0, totalCount: 0 },
  };
}
const cover = { id: "11", entryId: "101", imageUrl: "/wall-study.jpg", alt: "River study" };
const peerCover = { ...cover, id: "12", entryId: "102" };
function art(): RoundDetail {
  const detail = feedback();
  return { ...detail,
    round: { ...detail.round, id: "2", name: "Art before the chorus", templateKey: "art_before_chorus" },
    viewerState: { ...detail.viewerState, role: "participant", status: "active", canJoin: false },
    roundState: { key: "art_before_chorus", phase: "collecting_covers", isHost: false,
      config: { responseFormat: "audio_text", sketchSize: "small" },
      coverProgress: { submitted: 2, minimum: 3, remaining: 1, waitingPastSchedule: false }, participants: [], viewer: {}, results: [],
    },
  };
}
function Fixture({ details, compact = false, participation = true }: { details: RoundDetail[]; compact?: boolean; participation?: boolean }) {
  const [cache] = useState(() => new Map());
  const [action, setAction] = useState("");
  const fallback = Object.fromEntries(details.map(detail => [unstable_serialize(["activity", detail.round.id]), detail]));
  return <SWRConfig value={{ provider: () => cache, fallback, revalidateOnMount: false, revalidateOnFocus: false, revalidateOnReconnect: false, refreshInterval: 0 }}>
    <StoryNavigation onNavigate={destination => setAction(`Open Round: ${destination}`)}>
      <ScrollView style={styles.frame} contentContainerStyle={styles.content}>
        {details.map(detail => <View key={detail.round.id} style={layout.section}>
          <CurrentRound round={detail.round} participation={participation} reportActions={() => {}} compact={compact} />
        </View>)}
        {action ? <Text accessibilityLiveRegion="polite" style={layout.muted}>{action}</Text> : null}
      </ScrollView>
    </StoryNavigation>
  </SWRConfig>;
}
export const JoinFeedback = () => <Fixture details={[feedback()]} />;
export const ShareFeedbackEntry = () => {
  const detail = feedback();
  detail.viewerState = { ...detail.viewerState, role: "participant", status: "active", canJoin: false, canSubmit: true };
  return <Fixture details={[detail]} />;
};
export const ReviewFeedback = () => {
  const detail = feedback();
  detail.phase = "feedback";
  detail.viewerState = { ...detail.viewerState, role: "reviewer", status: "active", canJoin: false, canReview: true };
  detail.submissions = [{ id: "1", entryId: "101", userId: "2", displayUsername: "Maya", submittedAt: "2026-10-28T12:00:00Z", replyCount: 0, content: text("A work in progress"), format: "mixed_media" }];
  return <Fixture details={[detail]} />;
};
export const AddCover = () => <Fixture details={[art()]} />;
export const CoverSubmitted = () => {
  const detail = art(); detail.roundState!.viewer.cover = cover;
  return <Fixture details={[detail]} />;
};
export const ChooseCover = () => {
  const detail = art(); detail.roundState!.phase = "collecting_responses";
  detail.roundState!.viewer = { cover, offeredCovers: [peerCover, { ...peerCover, id: "13", entryId: "103" }] };
  return <Fixture details={[detail]} />;
};
export const MakeResponse = () => {
  const detail = art(); detail.roundState!.phase = "collecting_responses";
  detail.roundState!.viewer = { cover, chosenCover: peerCover };
  return <Fixture details={[detail]} />;
};
export const ResponseSubmitted = () => {
  const detail = art(); detail.roundState!.phase = "collecting_responses";
  detail.roundState!.viewer = { cover, chosenCover: peerCover, response: { id: "21", entryId: "201", creatorName: "Alex", format: "mixed_media", content: text("A quiet refrain"), coverId: peerCover.id } };
  return <Fixture details={[detail]} />;
};
export const Complete = () => {
  const detail = feedback(); detail.phase = "complete"; detail.round.status = "archived";
  return <Fixture details={[detail]} />;
};
export const Visitor = () => <Fixture details={[feedback()]} participation={false} />;
export const SimultaneousRounds = () => <Fixture details={[feedback(), art()]} />;
export const CompactLongName = () => {
  const detail = feedback(); detail.round.name = "Small hours: unfinished landscapes and the sounds we keep returning to";
  return <Fixture details={[detail]} compact />;
};
const styles = StyleSheet.create({ frame: { width: "100%", maxWidth: 560, height: 820, alignSelf: "center" }, content: { padding: 16, gap: 24 } });
