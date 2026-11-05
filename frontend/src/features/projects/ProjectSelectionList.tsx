import { ActivityIndicator, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import type { useProjects } from "../../hooks/useProjects";
import { layout } from "../../styles/layout";
import { homeProjectStyles } from "../home/homeProjectStyles";
import { ProjectIcon } from "./ProjectIcon";

/** One owned-project listing for choosing a source or a destination. */
export function ProjectSelectionList({ projects, selected, onSelect, disabled = false }: {
  projects: ReturnType<typeof useProjects>;
  selected?: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  return <>
    {projects.isLoading && <ActivityIndicator accessibilityLabel="Loading projects" />}
    {projects.error && <Button onPress={() => void projects.mutate().catch(() => {})}>Retry projects</Button>}
    <View style={homeProjectStyles.list}>
      {!projects.error && projects.data?.projects.filter(item => item.viewer_participation === "owner").map(item => <Button key={item.id} emphasis="ghost" disabled={disabled}
        selected={selected === String(item.id)} style={homeProjectStyles.listRow} onPress={() => onSelect(String(item.id))}>
        <ProjectIcon name={item.name} imageUrl={item.icon_url} symbol={item.icon_symbol} themeColor={item.icon_color} />
        <Text style={[layout.text, layout.grow]}>{item.name}</Text><Icon name={selected === String(item.id) ? "checkBold" : "caretRight"} size={16} />
      </Button>)}
    </View>
    {projects.hasMore && <Button disabled={disabled || projects.isValidating} onPress={() => void projects.loadMore().catch(() => {})}>Load more projects</Button>}
  </>;
}
