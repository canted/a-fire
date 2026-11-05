import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { RoomWall } from "./RoomWall";
import { roomWallMembers, roundResultMembers, type WallMemberModel } from "./wall/wallModel";
import type { WallDetail } from "../../lib/api/walls";
import { layout } from "../../styles/layout";
export default { title: "Expo/Rooms/Wall", component: RoomWall };
const content = { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text: "A small study of the light across the room." }] }] };
const result: WallDetail = { id: "1", roomId: "2", roundId: "3", title: "Light studies", description: null, publishedAt: "2026-11-02", templateKey: "feedback", entries: [
  { id: "1", entryId: "10", authorName: "Alex", authorAvatarUrl: null, available: true, content, format: "mixed_media", formatData: { title: "Morning light" }, responseCount: 1, responseParticipants: [{ id: 2, username: "Sam" }] },
  { id: "2", entryId: "11", authorName: "Sam", authorAvatarUrl: null, available: true, content, format: "mixed_media", formatData: { title: "Evening light" }, responseCount: 0, responseParticipants: [] },
] };
function Fixture({ members, narrow = false }: { members: WallMemberModel[]; narrow?: boolean }) {
  const [action, setAction] = useState("");
  return <View style={[styles.frame, narrow && styles.narrow]}>
    <RoomWall members={members} emptyMessage="Nothing shared yet." onOpenEntry={entry => setAction(`Open entry ${entry.id}`)} onOpenFeedback={(entry, reply) => setAction(`Open entry ${entry.id}, reply ${reply}`)} />
    <Text accessibilityLiveRegion="polite" style={layout.muted}>{action}</Text>
  </View>;
}
export const Live = () => <Fixture members={roomWallMembers([{ membershipId: "1", userId: "1", username: "Alex", latestEntry: { id: "10", content, createdAt: "2026-11-02", room_statement: "Looking for the quieter parts." } }, { membershipId: "2", userId: "2", username: "Sam", latestEntry: null }])} />;
export const RoundResult = () => <Fixture members={roundResultMembers(result)} />;
export const MobileRoundResult = () => <Fixture members={roundResultMembers(result)} narrow />;
export const Empty = () => <Fixture members={[]} />;
export const UnavailableContribution = () => <Fixture members={roundResultMembers({ ...result, entries: [result.entries[0], { ...result.entries[1], available: false, content: null, entryId: null }] })} />;
const styles = StyleSheet.create({ frame: { padding: 16, width: "100%", maxWidth: 900, alignSelf: "center" }, narrow: { maxWidth: 390 } });
