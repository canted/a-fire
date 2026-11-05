import { useSaveMessageToProject } from "../../hooks/useSaveMessageToProject";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { useEffect, useRef, useState } from "react";
import { Input } from "../../components/Input";
import { randomUuid } from "../../lib/randomId";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/Button";
import { SafeAreaView } from "react-native-safe-area-context";
import { ProjectIcon } from "../projects/ProjectIcon";
import {
  useThreadMessage,
} from "../../hooks/useChatActions";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";

export function SaveMessageScreen() {
  const { roomId, messageId, request, newProject } = useLocalSearchParams<{
    roomId: string;
    messageId: string;
    request?: string;
    newProject?: string;
  }>();
  const router = useRouter();
  const generatedRequest = useRef(randomUuid()).current;
  useEffect(() => { if (!request) router.setParams({ request: generatedRequest }); }, [request, generatedRequest, router]);
  const navigation = useRoomNavigation();
  const source = useThreadMessage(roomId, messageId);
  const creating = newProject === "1";
  const setCreating = (value: boolean) => router.setParams({ newProject: value ? "1" : undefined });
  const [name, setName] = useState("");
  const leave = () => navigation.back(roomId, messageId);
  const { action, creation, createdProject, busy, error, save } = useSaveMessageToProject({ roomId, messageId, request, name, leave });
  const author =
    source.data?.author?.display_username ??
    source.data?.masked_author?.display_username ??
    "this member";
  const content = (
    <SafeAreaView style={styles.overlay}>
      <Button
        emphasis="ghost"
        style={StyleSheet.absoluteFill}
        accessibilityLabel="Cancel save to project"
        disabled={busy}
        onPress={leave}
      >
        {null}
      </Button>
      <View accessibilityViewIsModal {...(Platform.OS === "web" ? { role: "dialog", "aria-label": "Save to project" } : {})} style={styles.dialog}>
        <ScrollView contentContainerStyle={styles.contents}>
          <View style={layout.row}>
            <Text
              accessibilityRole="header"
              style={[layout.title, layout.grow]}
            >
              Save to project
            </Text>
            <Button
              emphasis="bare"
              accessibilityLabel="Close save to project"
              disabled={busy}
              onPress={leave}
            >
              <Icon name="x" size={20} />
            </Button>
          </View>
          <>
            <Text style={layout.text}>
              Keep a private copy of {author}’s message and any existing attachments in one of your projects.
            </Text>
            {source.isLoading && (
              <ActivityIndicator accessibilityLabel="Loading message" />
            )}
            {source.error ? (
              <>
                <Text accessibilityRole="alert" style={layout.text}>
                  This message could not be loaded.
                </Text>
                <Button
                  style={styles.target}
                  onPress={() => {
                    void source.mutate().catch(() => {});
                  }}
                >
                  Retry message
                </Button>
              </>
            ) : null}
            {action.projects.isLoading && (
              <ActivityIndicator accessibilityLabel="Loading projects" />
            )}
            {action.projects.error ? (
              <>
                <Text accessibilityRole="alert" style={layout.text}>
                  Could not load your projects.
                </Text>
                <Button
                  style={styles.target}
                  onPress={() => {
                    void action.projects.mutate().catch(() => {});
                  }}
                >
                  Retry projects
                </Button>
              </>
            ) : (
              action.eligible.map((project) => (
                <Button
                  key={project.id}
                  accessibilityLabel={project.name}
                  style={styles.choice}
                  emphasis="ghost"
                  disabled={
                    !source.data ||
                    Boolean(source.error) ||
                    busy
                  }
                  onPress={() => void save(project)}
                >
                  <ProjectIcon
                    name={project.name}
                    imageUrl={project.icon_url}
                    symbol={project.icon_symbol}
                    themeColor={project.icon_color}
                  />
                  <Text style={[layout.text, layout.grow]}>{project.name}</Text>
                </Button>
              ))
            )}
            {action.projects.hasMore && <Button disabled={action.projects.isValidating || busy} onPress={() => void action.projects.loadMore().catch(() => {})}>Load more projects</Button>}
            {!action.projects.isLoading && !action.projects.error && (
              <>
                <Text style={layout.muted}>
                  {!action.eligible.length && !action.projects.hasMore
                    ? "You don’t have a project you can save to yet."
                    : "Or start a new project."}
                </Text>
                {creating ? (
                  <View style={styles.newProject}>
                    <Input
                      accessibilityLabel="Project name (optional)"
                      placeholder="Project name (optional)"
                      value={createdProject?.name ?? name}
                      onChangeText={setName}
                      editable={!busy && !createdProject}
                    />
                    <Text style={layout.muted}>
                      {createdProject ? `Created ${createdProject.name}. Retry saving this message to it.` : "Leave the name blank to create Untitled."}
                    </Text>
                    <Button
                      disabled={busy || !request || !source.data || Boolean(source.error)}
                      onPress={() => void save()}
                    >
                      {createdProject ? "Retry save to project" : "Create project and save"}
                    </Button>
                    {!createdProject && <Button emphasis="link" disabled={busy} onPress={() => setCreating(false)}>Choose an existing project</Button>}
                  </View>
                ) : (
                  <Button style={styles.target} emphasis="link" disabled={busy} onPress={() => setCreating(true)}>
                    Create a project
                  </Button>
                )}
              </>
            )}
            <View style={styles.footer}>
              <Button
                style={styles.target}
                emphasis="ghost"
                disabled={busy}
                onPress={leave}
              >
                Cancel
              </Button>
            </View>
            {busy && (
              <Text accessibilityLiveRegion="polite" style={layout.muted}>
                {creation.isMutating ? "Creating project…" : "Saving…"}
              </Text>
            )}
            {error && (
              <Text accessibilityRole="alert" style={layout.text}>
                {error}
              </Text>
            )}
          </>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
  return Platform.OS === "web" ? (
    <Modal
      visible
      transparent
      onRequestClose={() => {
        if (!busy) leave();
      }}
    >
      {content}
    </Modal>
  ) : (
    content
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    backgroundColor: "rgba(26, 37, 39, 0.35)",
  },
  dialog: {
    width: "100%",
    maxWidth: 448,
    maxHeight: "90%",
    borderRadius: 16,
    backgroundColor: tokens.paper,
  },
  contents: { padding: 24, gap: 16 },
  newProject: { gap: 12 },
  projectImage: { width: 24, height: 24 },
  target: { minHeight: 48 },
  footer: { alignItems: "flex-end" },
  choice: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: tokens.border,
    paddingHorizontal: 12,
    flexDirection: "row",
    gap: 8,
    minHeight: 48,
    backgroundColor: tokens.paper,
  },
});
