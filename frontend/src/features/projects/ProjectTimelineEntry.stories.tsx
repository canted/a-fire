import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ProjectTimelineEntry } from "./ProjectScreen";
import type { ProjectEntry } from "../../lib/api/projectEntries";
import { layout } from "../../styles/layout";

export default { title: "Expo/Projects/Saved feedback", component: ProjectTimelineEntry };
const document = (text: string) => ({ type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const feedback: ProjectEntry = {
  id: 92, kind: "feedback", author: { id: 1, username: "Alex" },
  created_at: "2026-10-28T12:00:00Z", updated_at: "2026-10-28T12:00:00Z",
  content: document("The quiet space before the final line makes the ending feel open."),
  format: "mixed_media", can_edit: false, can_share: false, submissions: [],
  source_entry_id: 91, source_shared_entry_id: 101, source_reply_id: 201,
  source_room_id: 7, source_author_name: "Maya", source_available: true,
};
function Fixture({ entry = feedback, detail = false, narrow = false }: { entry?: ProjectEntry; detail?: boolean; narrow?: boolean }) {
  const [destination, setDestination] = useState("");
  return <ScrollView style={[styles.frame, narrow && styles.narrow]} contentContainerStyle={styles.content}>
    <ProjectTimelineEntry entry={entry} detail={detail} projectId="12"
      open={() => setDestination(`/app/projects/12/entries/${entry.id}`)}
      edit={() => { throw new Error("Saved feedback is immutable."); }}
      share={() => { throw new Error("Feedback is shared through its source entry."); }}
      openLink={setDestination} />
    {destination ? <View style={layout.section}><Text accessibilityLiveRegion="polite" style={layout.muted}>Open: {destination}</Text></View> : null}
  </ScrollView>;
}
export const Overview = () => <Fixture />;
export const EntryDetail = () => <Fixture detail />;
export const OriginalUnavailable = () => <Fixture entry={{ ...feedback, source_available: false }} detail />;
export const ProjectLevelMessage = () => <Fixture entry={{ ...feedback, source_entry_id: undefined, source_shared_entry_id: undefined, source_reply_id: undefined, source_chat_message_id: 301 }} />;
export const RetainedImage = () => <Fixture entry={{ ...feedback, source_available: false, content: {
  type: "doc", content: [...document("I marked the part that caught my eye.").content,
    { type: "image", attrs: { src: "/wall-study.jpg", width: 843, height: 1116, alt: "Saved river study" } }],
} }} detail />;
export const LongAuthorName = () => <Fixture entry={{ ...feedback, source_author_name: "Alexandria Rivera — Community Printmaking Workshop" }} narrow />;
const styles = StyleSheet.create({ frame: { width: "100%", maxWidth: 560, height: 820, alignSelf: "center" }, narrow: { maxWidth: 320 }, content: { padding: 16, gap: 16 } });

export function ConnectedReplies() {
  const [destination, setDestination] = useState("");
  const source: ProjectEntry = { ...feedback, id: 91, kind: "material", can_edit: true, can_share: true, source_entry_id: null, content: document("A small recording of the last verse, leaving room before the final line.") };
  const items = [source, feedback, { ...feedback, id: 93, source_author_name: "Jon", content: document("Keep that pause. It makes the ending land.") }];
  return <ScrollView style={[styles.frame, styles.narrow]} contentContainerStyle={[styles.content, { gap: 24 }]}>
    {items.map((entry, index) => <ProjectTimelineEntry key={entry.id} entry={entry} connected={index > 0} detail={false} projectId="12" open={() => setDestination(String(entry.id))} edit={() => setDestination("Edit")} share={() => setDestination("Share")} openLink={setDestination} />)}
    {destination && <Text>{destination}</Text>}
  </ScrollView>;
}

export function ShareWithSavedReplies() {
  const [destination, setDestination] = useState("");
  const source: ProjectEntry = { ...feedback, id: 91, kind: "material", can_edit: true, can_share: true, source_entry_id: null, content: document("A small recording of the last verse."), submissions: [{ id: 101, room_id: 7, room_name: "A Music Workshop", reply_count: 2 }] };
  return <ScrollView style={[styles.frame, styles.narrow]} contentContainerStyle={styles.content}>
    <ProjectTimelineEntry entry={source} savedReplies={[feedback, { ...feedback, id: 93, source_author_name: "Jon" }]} detail={false} projectId="12" open={() => setDestination("Open")} edit={() => setDestination("Edit")} share={() => setDestination("Share")} openLink={setDestination} />
    {destination && <Text>{destination}</Text>}
  </ScrollView>;
}

export const AutomatedCapture = () => <Fixture entry={{ ...feedback, kind: "material", automated_creation: true, source_author_name: undefined, can_edit: true, can_share: true }} />;
