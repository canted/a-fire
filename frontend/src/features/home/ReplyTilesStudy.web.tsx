import { useState } from "react";
import { HomeProjectTiles } from "./HomeProjectTiles.web";
import type { HomeProjectTilesProps } from "./HomeProjectTiles";
import type { ProjectEntry, ProjectSummary } from "../../lib/api/projectEntries";
import styles from "./ReplyTiles.stories.module.css";

export default { title: "Expo/Projects/Reply tile studies", component: HomeProjectTiles };
const person = { id: 1, username: "Alex" };
const project: ProjectSummary = { id: 1, name: "Light studies", owner: person, participants: [], pending_participants: [], rooms: [], updated_at: "2026-11-04", viewer_participation: "owner", icon_color: "yellow" };
const doc = (text: string) => ({ type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const original: ProjectEntry = { id: 1, kind: "material", author: person, created_at: "2026-11-04", updated_at: "2026-11-04", content: { type: "doc", content: [{ type: "image", attrs: { src: "/wall-study.jpg", width: 843, height: 1116, alt: "River and open sky" } }] }, format: "mixed_media", can_edit: true, can_share: true, submissions: [] };
const reply: ProjectEntry = { ...original, id: 2, kind: "feedback", source_author_name: "Maya", content: doc("The quiet space before the final line makes the ending feel open. Could you leave that pause a little longer?"), can_edit: false };
const entries = [original, reply, { ...original, id: 3, content: doc("Morning notes"), intent: "Morning notes" }, { ...reply, id: 4, source_author_name: "Jon", content: original.content }].map(entry => ({ project, entry }));
const treatments = [
  ["outlined", "Border + author", "A defined edge separates the reply from the work. The author stays in a dedicated header."],
  ["inset", "Inset paper", "A warm frame encloses a paper reply. Quieter than a dark outline, with less room for content."],
  ["ribbon", "Author strip", "The author sits over the content. Media stays prominent; the strip carries the distinction."],
] as const;
function Study({ treatment, narrow = false, replyFirst = false }: { treatment: NonNullable<HomeProjectTilesProps["replyTreatment"]>; narrow?: boolean; replyFirst?: boolean }) {
  const [opened, setOpened] = useState("");
  return <div className={narrow ? styles.phone : styles.desktop}>
    <HomeProjectTiles entries={replyFirst ? [entries[1], entries[0], entries[2], entries[3]] : entries} replyTreatment={treatment} onOpenEntry={({ entry }) => setOpened(entry.kind === "feedback" ? `Open saved reply from ${entry.source_author_name}` : "Open project work")} />
    <p className={styles.status} aria-live="polite">{opened}</p>
  </div>;
}
export const Comparison = () => <main className={styles.page}>
  <h1>Replies among your work</h1><p>Same content and tiling, three ways to distinguish a saved reply. Tap a tile to check its action.</p>
  {treatments.map(([treatment, title, description]) => <section key={treatment} className={styles.section}>
    <h2>{title}</h2><p>{description}</p><div className={styles.examples}><Study treatment={treatment} /><Study treatment={treatment} narrow /></div>
  </section>)}
</main>;
export const ReplyFirst = () => <main className={styles.page}>{treatments.map(([treatment, title]) => <section key={treatment} className={styles.section}><h2>{title} · reply first</h2><Study treatment={treatment} replyFirst narrow /></section>)}</main>;
