import { PageScrollView } from "../../components/PageScrollView";
import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { ViewportShell } from "../../components/ViewportShell";
import { useEntryProject } from "../../hooks/useEntryProject";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { layout } from "../../styles/layout";

export function EntryProjectScreen() {
  const { entryId: postId } = useLocalSearchParams<{ entryId: string }>();
  const { entry: entry, projects, assignment } = useEntryProject(postId);
  const navigation = useRoomNavigation();
  const [error, setError] = useState<string>();
  const leave = () => navigation.returnTo(`/app/entries/${postId}`);
  const choose = async (project: number | null) => {
    setError(undefined);
    try {
      await assignment.trigger(project);
      leave();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The project could not be changed.",
      );
    }
  };
  const loading = entry.isLoading || projects.isLoading;
  const failed = entry.error || projects.error;
  const current = entry.data?.entry.project_id ?? null;
  return (
    <ViewportShell>
      <PageScrollView contentContainerStyle={[layout.section]}>
        <View style={layout.row}>
          <Button
            size="icon"
            emphasis="bare"
            accessibilityLabel="Back to entry"
            disabled={assignment.isMutating}
            onPress={leave}
          >
            <Icon name="caretCircleLeft" size={28} />
          </Button>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            ellipsizeMode="tail"
            style={layout.appBarTitle}
          >
            Choose project
          </Text>
        </View>
        <Text style={layout.text}>
          Only projects associated with this entry’s room are available.
        </Text>
        {loading && <ActivityIndicator accessibilityLabel="Loading projects" />}
        {failed && (
          <>
            <Text accessibilityRole="alert" style={layout.text}>
              Couldn’t load projects for this entry.
            </Text>
            <Button
              onPress={() => {
                void Promise.allSettled([entry.mutate(), projects.mutate()]);
              }}
            >
              Retry projects
            </Button>
          </>
        )}
        {!loading && !failed && entry.data && (
          <View style={layout.section}>
            <Button
              emphasis={current === null ? "solid" : "outline"}
              selected={current === null}
              disabled={assignment.isMutating}
              onPress={() => {
                void choose(null);
              }}
            >
              No project
            </Button>
            {projects.data?.projects.map((project) => (
              <Button
                key={project.id}
                emphasis={current === project.id ? "solid" : "outline"}
                selected={current === project.id}
                disabled={assignment.isMutating}
                onPress={() => {
                  void choose(project.id);
                }}
              >
                {project.name}
              </Button>
            ))}
            {projects.hasMore && <Button disabled={projects.isValidating || assignment.isMutating} onPress={() => void projects.loadMore().catch(() => {})}>Load more projects</Button>}
            {!projects.data?.projects.length && !projects.hasMore && current === null && (
              <Text style={layout.muted}>
                You don’t have any projects in this room yet.
              </Text>
            )}
          </View>
        )}
        {error && (
          <Text accessibilityRole="alert" style={layout.text}>
            {error}
          </Text>
        )}
      </PageScrollView>
    </ViewportShell>
  );
}
