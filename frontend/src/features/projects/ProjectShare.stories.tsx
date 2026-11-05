import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { ProjectShareSelection } from "./ProjectShare";
import { buildEntryShareManifest } from "../../lib/entryShareSelection";
export default { title: "Expo/Projects/Share selection" };
const document = (text: string) => ({ type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const manifest = buildEntryShareManifest({
  revision: "story-v1", format: "mixed_media", format_data: { title: "Leaving the sky unfinished" },
  content: { type: "doc", content: [...document("The body stays together as one selection, even when the entry contains several paragraphs.").content,
    { type: "image", attrs: { src: "/wall-study.jpg", width: 843, height: 1116, alt: "River study" } },
    { type: "image", attrs: { src: "/wall-study.jpg", width: 843, height: 1116, alt: "Second study" } }] },
  feedback: [
    { id: 1, originalRoomId: 7, authorized: true, authorName: "Maya", content: document("The open sky gives the trees room to breathe.") },
    { id: 3, originalRoomId: 7, authorized: false, authorName: "A former participant", content: document("Retained privately, but no longer available to share.") },
    { id: 2, originalRoomId: 8, authorized: true, authorName: "Jon", content: document("Feedback from another Room stays out of this share.") },
  ],
}, 7);
function Fixture({ busy = false, initial = "all", narrow = false }: { busy?: boolean; initial?: "all" | "media" | "none"; narrow?: boolean }) {
  const [selected, setSelected] = useState(manifest.units.filter(unit => unit.eligible && (initial === "all" || initial === "media" && unit.kind === "media")).map(unit => unit.id));
  return <ScrollView style={[styles.frame, narrow && styles.narrow]}><View style={styles.content}>
    <ProjectShareSelection manifest={manifest} selected={selected} disabled={busy}
      toggle={id => setSelected(value => value.includes(id) ? value.filter(item => item !== id) : [...value, id])} />
  </View></ScrollView>;
}
export const InitiallySelected = () => <Fixture />;
export const Sharing = () => <Fixture busy />;
export const TitleBodyAndFeedbackExcluded = () => <Fixture initial="media" />;
export const NothingSelected = () => <Fixture initial="none" />;
export const NarrowSelection = () => <Fixture narrow />;
const styles = StyleSheet.create({ frame: { height: 820, maxWidth: 560, alignSelf: "center", width: "100%" }, narrow: { maxWidth: 390 }, content: { padding: 16 } });
