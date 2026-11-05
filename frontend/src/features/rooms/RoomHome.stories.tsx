import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { RoomHome, RoomRoundContext } from "./RoomHome";
import type { useRoomHome } from "../../hooks/useRoomHome";
import type { EntryPreview, RoomMemberPreview } from "../../lib/api/roomEntryPreviews";
import { layout } from "../../styles/layout";

type HomeQuery = ReturnType<typeof useRoomHome>;
export default { title: "Expo/Rooms/Home", component: RoomHome };

function snapshot(id: string, title: string, day: number, image = false): EntryPreview {
  return {
    id, format: "mixed_media", formatData: { title }, createdAt: `2026-10-${day}T12:00:00Z`,
    content: { type: "doc", content: [
      ...(image ? [{ type: "image", attrs: { src: "/wall-study.jpg", width: 843, height: 1116, alt: "A river study with open sky" } }] : []),
      { type: "paragraph", content: [{ type: "text", text: "Leaving some room for the next attempt. This is the version shared with the Room." }] },
    ] },
    replyCount: 0, replyParticipants: [], savedResponses: [],
  };
}
const latest = { ...snapshot("101", "Leaving the sky unfinished", 28, true), replyCount: 4,
  replyParticipants: [{ id: 2, username: "Maya" }, { id: 3, username: "Jon" }] };
const artists: RoomMemberPreview[] = [
  { id: "1", username: "Alex", latestEntry: latest, recentEntries: [latest, snapshot("102", "The first wash", 26)] },
  { id: "2", username: "Maya", latestEntry: snapshot("201", "A smaller gesture", 28), recentEntries: [snapshot("201", "A smaller gesture", 28)] },
  { id: "3", username: "Jon", latestEntry: snapshot("301", "Morning notes", 27), recentEntries: [snapshot("301", "Morning notes", 27), snapshot("302", "An earlier version", 25)] },
];
function response<T>(data: T) {
  return { data, error: undefined, isLoading: false, isValidating: false, mutate: async () => data };
}
function query(memberSlots: RoomMemberPreview[] = artists): HomeQuery {
  return {
    home: response({ roomId: "1", members: memberSlots.map(({ id, ...preview }) => ({ ...preview, membershipId: id, userId: id })), viewer_access: { kind: "member" as const, can_write: true, can_reply: true, entry_history: "all" as const } }),
    room: response({ id: 1, name: "Studio", owner_id: 1, porosity: "closed" as const }),
    rounds: response({ activeRound: null, nextRound: null, recentRounds: [] }),
    position: response(0),
    roomData: undefined, current: [], participation: true,
  };
}
function Fixture({ value, narrow = false }: { value: HomeQuery; narrow?: boolean }) {
  const [action, setAction] = useState("");
  return <View style={[styles.frame, narrow && styles.narrow]}>
    <RoomHome query={value}
      openEntry={(entry, reply) => setAction(reply ? `Open entry ${entry.id}, reply ${reply}` : `Open entry ${entry.id}`)}
      openHistory={() => setAction("Open Round history")} />
    {action ? <Text accessibilityLiveRegion="polite" style={layout.muted}>{action}</Text> : null}
  </View>;
}
export const SharedEntries = () => <Fixture value={query()} />;
export const MobilePairedRows = () => <Fixture value={query()} narrow />;
export const Empty = () => <Fixture value={query([])} />;
export const Loading = () => {
  const value = query([]);
  return <Fixture value={{ ...value, home: { ...value.home, data: undefined, isLoading: true }, rounds: { ...value.rounds, data: undefined, isLoading: true } }} />;
};
export const RoomUnavailable = () => {
  const value = query();
  return <Fixture value={{ ...value, home: { ...value.home, error: new Error("Offline") } }} />;
};
export const RoundsUnavailable = () => {
  const value = query();
  return <Fixture value={{ ...value, rounds: { ...value.rounds, error: new Error("Offline") } }} />;
};
export function RetryRounds() {
  const [failed, setFailed] = useState(true);
  const value = query();
  return <Fixture value={{ ...value, rounds: {
    ...value.rounds, error: failed ? new Error("Offline") : undefined,
    mutate: async () => { setFailed(false); return value.rounds.data; },
  } }} />;
}
export function ChatRoundRoomReadFailed() {
  const [failed, setFailed] = useState(true);
  const value = query();
  return <View style={styles.narrow}><RoomRoundContext compact query={{ ...value, room: {
    ...value.room, error: failed ? new Error("Room request failed") : undefined,
    mutate: async () => { setFailed(false); return value.room.data; },
  } }} />{!failed && <Text style={layout.muted}>Room loaded. No current rounds.</Text>}</View>;
}
export const AccessLostWithCachedEntries = () => {
  const value = query();
  return <Fixture value={{ ...value, room: { ...value.room, error: new Error("Room access is no longer available") } }} />;
};
export function RetryRoom() {
  const [failed, setFailed] = useState(true);
  const value = query();
  return <Fixture value={{ ...value, home: {
    ...value.home,
    error: failed ? new Error("Offline") : undefined,
    mutate: async () => { setFailed(false); return value.home.data; },
  } }} />;
}
// Deliberately shared feedback uses the production public snapshot contract.
// Saving feedback privately alone does not populate shared_feedback.
export const ExplicitPublicFeedbackSnapshot = () => {
  const entry: EntryPreview = { ...latest, room_statement: "Following the space around the trees.", shared_feedback: [{
    source_reply_id: 401, source_shared_entry_id: 101, source_room_id: 1, source_author_id: 2,
    author_name: "Maya", format: "mixed_media", format_data: null,
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "The open sky gives the trees room to breathe." }] }] },
  }] };
  return <Fixture value={query([{ ...artists[0], latestEntry: entry, recentEntries: [entry] }, artists[1]])} narrow />;
};
const styles = StyleSheet.create({
  frame: { height: 820, width: "100%", maxWidth: 900, alignSelf: "center" },
  narrow: { maxWidth: 390 },
});
