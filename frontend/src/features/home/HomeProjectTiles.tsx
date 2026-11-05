import { StyleSheet, Text, View } from "react-native";
import type { HomeSnapshot } from "../../lib/homeModel";
import { materialPresentation } from "../../lib/materialDocument";
import { Button } from "../../components/Button";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { EntryContent } from "../content/EntryContent";
import { ProjectIcon } from "../projects/ProjectIcon";
import { ActivityPreview } from "./ActivityScreen";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";
export type HomeProjectTilesProps = {
  data?: HomeSnapshot;
  replyTreatment?: "outlined" | "inset" | "ribbon";
  onOpenEntry?: (item: NonNullable<HomeSnapshot["recentEntries"]>[number]) => void;
  entries: NonNullable<HomeSnapshot["recentEntries"]>;
};
/** Native presentation retained while web adopts the canonical browser mosaic. */
export function HomeProjectTiles({ data, entries, onOpenEntry }: HomeProjectTilesProps) {
  const navigation = useRoomNavigation();
  return (
    <View style={styles.grid}>
      {entries.map(({ project, entry }) => (
        <Button
          key={entry.id}
          emphasis="bare"
          accessibilityLabel={`Open entry in ${project.name}`}
          style={styles.tile}
          onPress={() =>
            onOpenEntry ? onOpenEntry({ project, entry }) : navigation.destination(
              `/app/projects/${project.id}/entries/${entry.id}`,
            )
          }
        >
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <EntryContent
              interactive={false}
              preview
              entry={materialPresentation(entry)}
            />
          </View>
          <View style={layout.row}>
            <ProjectIcon
              name={project.name}
              imageUrl={project.icon_url}
              symbol={project.icon_symbol}
              themeColor={project.icon_color}
            />
            <Text style={layout.muted}>{project.name}</Text>
          </View>
        </Button>
      ))}
      {data && <Button
        emphasis="bare"
        accessibilityLabel="View your project activity"
        style={styles.tile}
        onPress={() => navigation.destination("/app/activity")}
      >
        <ActivityPreview data={data} />
      </Button>}
    </View>
  );
}
const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    padding: 4,
    borderRadius: 20,
    backgroundColor: tokens.paper,
  },
  tile: {
    width: "49%",
    minHeight: 160,
    maxHeight: 240,
    overflow: "hidden",
    padding: 12,
    borderRadius: 16,
    backgroundColor: tokens.surface,
    alignItems: "stretch",
    gap: 8,
  },
});
