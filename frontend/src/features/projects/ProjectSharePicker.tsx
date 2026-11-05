import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { PopupMenu } from "../../components/PopupMenu";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { useProjects, useProject } from "../../hooks/useProjects";
import { useHome } from "../../hooks/useHome";
import { useProjectTimeline } from "../../hooks/useProjectTimeline";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { HomeProjectTiles } from "../home/HomeProjectTiles";
import { ProjectSelectionList } from "./ProjectSelectionList";
import type { HomeSnapshot } from "../../lib/homeModel";
import { layout } from "../../styles/layout";
import { homeProjectStyles } from "../home/homeProjectStyles";

/** Browse private sources using the same tiles as Home; sharing retains its routed review. */
export function ProjectSharePicker({ room, roomName, onClose, create }: { room: string; roomName: string; onClose: () => void; create: () => void }) {
  const home = useHome();
  const projects = useProjects();
  const [project, setProject] = useState("");
  const selected = useProject(project || undefined);
  const timeline = useProjectTimeline(project, Boolean(selected.data && !selected.error && selected.data.viewer_participation === "owner"));
  const navigation = useRoomNavigation();
  const recent = home.error ? [] : home.data?.recentEntries ?? home.data?.recentProjects.flatMap(item => item.entry ? [{ project: item.project, entry: item.entry }] : []) ?? [];
  const entries = (project ? selected.data && !selected.error && !timeline.query.error
    ? timeline.entries.map(entry => ({ project: selected.data!, entry })) : [] : recent)
    .filter(({ project, entry }) => project.viewer_participation === "owner" && entry.kind === "material" && !entry.draft && entry.can_share);
  const open = ({ project, entry }: NonNullable<HomeSnapshot["recentEntries"]>[number]) => {
    onClose();
    navigation.destination(`/app/projects/${project.id}/entries/${entry.id}/share?room=${room}&preview=1`);
  };
  const loading = project ? selected.isLoading || timeline.query.isLoading : home.isLoading;
  return <PopupMenu mode="page" open title={`Share in ${roomName}`} actions={[]} onClose={onClose} width={760}>
    <View style={styles.content}>
      {Boolean(project) && <Button emphasis="ghost" style={styles.back} onPress={() => setProject("")}><Icon name="caretLeft" size={20} /><Text style={layout.text}>All projects</Text></Button>}
      <View style={homeProjectStyles.headingRow}><Text accessibilityRole="header" style={homeProjectStyles.heading}>{project ? selected.data?.name || "Project" : "Projects"}</Text></View>
      {loading && <ActivityIndicator accessibilityLabel="Loading your projects" />}
      {(project ? selected.error || timeline.query.error : home.error) && <Button onPress={() => void Promise.allSettled(project ? [selected.mutate(), timeline.query.mutate()] : [home.mutate()])}>Retry</Button>}
      {!!entries.length && <HomeProjectTiles entries={entries} onOpenEntry={open} />}
      {!loading && !entries.length && !(project ? selected.error || timeline.query.error : home.error) && <Text style={layout.muted}>{project ? "Nothing saved to share from this project yet." : "Choose a project below to find something to share."}</Text>}
      {Boolean(project) && timeline.hasMore && <Button disabled={timeline.query.isValidating} onPress={() => void timeline.query.setSize(timeline.query.size + 1).catch(() => {})}>Load more</Button>}
      {!project && <ProjectSelectionList projects={projects} onSelect={setProject} />}
      <Button emphasis="outline" onPress={create}>Create something new</Button>
    </View>
  </PopupMenu>;
}
const styles = StyleSheet.create({
  content: { gap: 16, padding: 16 },
  back: { flexDirection: "row", alignSelf: "flex-start", gap: 8 },
});
