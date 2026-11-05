import { PageScrollView } from "../../components/PageScrollView";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { ViewportShell } from "../../components/ViewportShell";
import { ProjectIcon } from "./ProjectIcon";
import { useProjects } from "../../hooks/useProjects";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";

export function ProjectsScreen() {
  const query = useProjects();
  const navigation = useRoomNavigation();
  return (
    <ViewportShell>
      <View style={[layout.content, layout.appBar]}>
        <Button
          size="icon"
          emphasis="bare"
          accessibilityLabel="Back to home"
          onPress={() => navigation.home()}
        >
          <Icon name="caretCircleLeft" size={28} />
        </Button>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          ellipsizeMode="tail"
          style={layout.appBarTitle}
        >
          Your projects
        </Text>
        <Button
          emphasis="bare"
          accessibilityLabel="New project"
          onPress={() => navigation.destination("/app/projects/new")}
        >
          <Icon name="plusBold" size={20} />
        </Button>
      </View>
      <PageScrollView contentContainerStyle={[layout.section]}>
        {query.isLoading && (
          <ActivityIndicator accessibilityLabel="Loading projects" />
        )}
        {query.error ? (
          <View style={layout.section}>
            <Text accessibilityRole="alert" style={layout.text}>
              Could not load projects.
            </Text>
            <Button
              onPress={() => {
                void query.mutate().catch(() => {});
              }}
            >
              Try again
            </Button>
          </View>
        ) : (
          query.data && (
            <>
              <View style={styles.list}>
                {query.data.projects.map((project) => (
                  <Button
                    key={project.id}
                    emphasis="bare"
                    style={styles.row}
                    onPress={() =>
                      navigation.destination(`/app/projects/${project.id}`)
                    }
                  >
                    <ProjectIcon
                      name={project.name}
                      imageUrl={
                        project.viewer_participation === "pending"
                          ? undefined
                          : project.icon_url
                      }
                      symbol={project.icon_symbol}
                      themeColor={project.icon_color}
                      size={24}
                    />
                    <Text style={[layout.text, layout.grow]}>
                      {project.name}
                    </Text>
                    {project.viewer_participation === "pending" && (
                      <Text style={layout.muted}>Invited</Text>
                    )}
                    <Icon name="caretRight" size={16} />
                  </Button>
                ))}
              </View>
              {!query.data.projects.length && (
                <Text style={layout.muted}>
                  You don’t have any projects yet.
                </Text>
              )}
            </>
          )
        )}
        {query.hasMore && <Button disabled={query.isValidating} onPress={() => void query.loadMore().catch(() => {})}>Load more projects</Button>}
      </PageScrollView>
    </ViewportShell>
  );
}
const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
  },
  list: {
    backgroundColor: tokens.paper,
    borderRadius: 16,
    paddingHorizontal: 12,
  },
  row: {
    minHeight: 48,
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-start",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border,
  },
});
