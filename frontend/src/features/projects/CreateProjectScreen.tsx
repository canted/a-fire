import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  projectColors,
  projectIdentity,
  randomProjectIdentity,
  projectSymbols,
} from "../../../../types/project-identity";
import { assertImageFile } from "../../lib/imageFile";
import { safeRoomReturn } from "../../lib/roomLinks";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { Icon } from "../../components/Icon";
import { AppImage } from "../../components/AppImage";
import { ViewportShell } from "../../components/ViewportShell";
import { useProject } from "../../hooks/useProjects";
import { useDraftNavigation } from "../../hooks/useDraftNavigation";
import type { ProjectDetail } from "../../lib/api/projectEntries";
import { useProjectCreation } from "../../hooks/useProjectCreation";
import { pickChatFile, releaseChatFile } from "../../lib/chatFiles";
import type { ChatAttachment } from "../../lib/chatComposition";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";

export function CreateProjectScreen() {
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const query = useProject(projectId);
  const router = useRouter();
  if (projectId && query.isLoading)
    return (
      <ViewportShell>
        <ActivityIndicator accessibilityLabel="Loading project settings" />
      </ViewportShell>
    );
  if (projectId && (query.error || !query.data?.can_edit))
    return (
      <ViewportShell>
        <View style={[layout.content, layout.section]}>
          <Text accessibilityRole="alert" style={layout.text}>
            {query.error
              ? "Could not load project settings."
              : "Only the project owner can change these settings."}
          </Text>
          {query.error && (
            <Button
              onPress={() => {
                void query.mutate().catch(() => {});
              }}
            >
              Try again
            </Button>
          )}
          <Button onPress={() => router.replace(`/app/projects/${projectId}`)}>
            Back to project
          </Button>
        </View>
      </ViewportShell>
    );
  return <ProjectForm key={projectId || "new"} project={query.data} />;
}
function ProjectForm({ project }: { project?: ProjectDetail }) {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [name, setName] = useState(project?.name || "");
  const [symbol, setSymbol] = useState<
    (typeof projectSymbols)[number] | undefined
  >(projectSymbols.find((value) => value === project?.icon_symbol));
  const [color, setColor] = useState<
    (typeof projectColors)[number] | undefined
  >(projectColors.find((value) => value === project?.icon_color));
  const [removeBanner, setRemoveBanner] = useState(false);
  const [banner, setBanner] = useState<ChatAttachment>();
  const [error, setError] = useState<string>();
  const [choicesWidth, setChoicesWidth] = useState(280);
  const [creationIdentity] = useState(randomProjectIdentity);
  const selected = project ? projectIdentity(name || "New project") : creationIdentity;
  const icon = symbol ?? selected.icon;
  const tone = color ?? selected.color;
  const creation = useProjectCreation(project ? String(project.id) : undefined);
  const guard = useDraftNavigation({
    dirty: false,
    busy: creation.isMutating,
    busyMessage: "Wait for the project to finish saving.",
    save: async () => {},
    onError: setError,
  });
  const mounted = useRef(true);
  const localFile = useRef(banner);
  localFile.current = banner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      releaseChatFile(localFile.current);
    };
  }, []);
  const leave = () =>
    next
      ? router.dismissTo(safeRoomReturn(next) as "/app")
      : project
        ? router.replace(`/app/projects/${project.id}`)
        : router.canGoBack()
          ? router.back()
          : router.replace("/app/projects");
  async function chooseBanner() {
    setError(undefined);
    let file: ChatAttachment | undefined;
    try {
      file = await pickChatFile("photo");
      if (!file) return;
      assertImageFile(file);
      releaseChatFile(banner);
      setBanner(file);
      setRemoveBanner(false);
    } catch (reason) {
      releaseChatFile(file);
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not select the banner.",
      );
    }
  }
  const submit = () => {
    if (!name.trim() || creation.isMutating) return;
    setError(undefined);
    void creation
      .submit({
        name: name.trim(),
        iconSymbol: icon,
        iconColor: tone,
        banner,
        removeBanner,
        removeIcon: Boolean(project?.icon_url),
      })
      .then((saved) => {
        if (mounted.current) {
          guard.release();
          if (next) leave();
          else router.replace(`/app/projects/${saved.id}`);
        }
      })
      .catch((reason) => {
        if (mounted.current)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not create the project. Try again.",
          );
      });
  };
  return (
    <ViewportShell>
      <View style={[layout.content, styles.header]}>
        <Button
          size="icon"
          emphasis="ghost"
          disabled={creation.isMutating}
          onPress={leave}
          accessibilityLabel="Back"
        >
          <Icon name="caretCircleLeft" size={28} />
        </Button>
        <Button
          size="sm"
          shape="pill"
          disabled={!name.trim() || creation.isMutating}
          onPress={submit}
        >
          {creation.isMutating
            ? "Saving…"
            : project
              ? "Save project"
              : "Create project"}
        </Button>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, layout.audioClearance]}
      >
        <View style={styles.form}>
          <View
            style={[styles.preview, { backgroundColor: `${tokens[tone]}1f` }]}
          >
            <Icon name={icon} size={64} color={tokens[tone]} />
          </View>
          <View style={styles.nameGroup}>
            <Input
              style={styles.name}
              onSubmitEditing={submit}
              returnKeyType="done"
              accessibilityLabel="Project name"
              placeholder="Project name"
              maxLength={120}
              value={name}
              editable={!creation.isMutating}
              onChangeText={setName}
            />
          </View>
          <View style={styles.identityOptions}>
            <View style={styles.field}>
              <Text style={styles.label}>Color</Text>
              <View
                style={styles.choices}
                onLayout={(event) =>
                  setChoicesWidth(event.nativeEvent.layout.width)
                }
              >
                {projectColors.map((value) => (
                  <Button
                    key={value}
                    style={[
                      styles.choice,
                      { width: (choicesWidth - 48) / 7 },
                      tone === value && { borderColor: tokens[value] },
                    ]}
                    selected={tone === value}
                    emphasis="bare"
                    disabled={creation.isMutating}
                    accessibilityLabel={`Project color ${value}${tone === value ? ", selected" : ""}`}
                    onPress={() => setColor(value)}
                  >
                    <View
                      style={[
                        styles.swatch,
                        { backgroundColor: tokens[value] },
                        tone === value && styles.selectedSwatch,
                      ]}
                    />
                  </Button>
                ))}
              </View>
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Project icon</Text>
              <View
                style={styles.choices}
                onLayout={(event) =>
                  setChoicesWidth(event.nativeEvent.layout.width)
                }
              >
                {projectSymbols.map((value) => (
                  <Button
                    key={value}
                    style={[
                      styles.choice,
                      { width: (choicesWidth - 48) / 7 },
                      styles.symbol,
                      icon === value && styles.selected,
                    ]}
                    selected={icon === value}
                    emphasis="bare"
                    disabled={creation.isMutating}
                    accessibilityLabel={`${value.replace("project", "").replace(/([a-z])([A-Z])/g, "$1 $2")}${icon === value ? ", selected" : ""}`}
                    onPress={() => setSymbol(value)}
                  >
                    <Icon
                      name={value}
                      size={26}
                      color={icon === value ? tokens[tone] : tokens.inkMuted}
                    />
                  </Button>
                ))}
              </View>
            </View>
          </View>
          <View style={styles.imageSection}>
            <Text style={styles.label}>
              Images <Text style={styles.hint}>(optional)</Text>
            </Text>
            <Text style={styles.hint}>
              JPEG, PNG, WebP, GIF or AVIF. Up to 20 MB each.
            </Text>
            <View style={styles.imageRow}>
              <View style={styles.banner}>
                {banner ? (
                  <AppImage
                    src=""
                    localPreview={{ uri: banner.uri }}
                    alt="Banner preview"
                    width={banner.width}
                    height={banner.height}
                    tiled
                  />
                ) : project?.banner_url && !removeBanner ? (
                  <AppImage
                    src={project.banner_url}
                    alt="Project banner"
                    tiled
                  />
                ) : (
                  <Text style={[styles.hint, { textAlign: "center" }]}>
                    No banner
                  </Text>
                )}
              </View>
              <View style={layout.grow}>
                <Text style={styles.label}>Banner</Text>
                {banner && <Text style={styles.hint}>{banner.name}</Text>}
                <View style={styles.imageActions}>
                  <Button
                    size="sm"
                    shape="pill"
                    emphasis="outline"
                    disabled={creation.isMutating}
                    onPress={() => {
                      void chooseBanner();
                    }}
                  >
                    {banner || (project?.banner_url && !removeBanner)
                      ? "Replace banner"
                      : "Choose banner"}
                  </Button>
                  {(banner || (project?.banner_url && !removeBanner)) && (
                    <Button
                      size="sm"
                      shape="pill"
                      emphasis="ghost"
                      accessibilityLabel="Remove banner"
                      disabled={creation.isMutating}
                      onPress={() => {
                        releaseChatFile(banner);
                        setBanner(undefined);
                        setRemoveBanner(true);
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </View>
              </View>
            </View>
          </View>
          {error && (
            <Text accessibilityRole="alert" style={layout.text}>
              {error}
            </Text>
          )}
        </View>
        {creation.isMutating && (
          <Text accessibilityLiveRegion="polite" style={styles.hint}>
            Saving your project…
          </Text>
        )}
      </ScrollView>
    </ViewportShell>
  );
}
const styles = StyleSheet.create({
  header: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  content: {
    width: "100%",
    maxWidth: 672,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  form: {
    backgroundColor: tokens.paper,
    borderRadius: 16,
    padding: 16,
    gap: 24,
  },
  name: {
    height: 52,
    borderWidth: 0,
    borderRadius: 999,
    backgroundColor: tokens.surface,
    textAlign: "center",
    fontSize: 18,
    fontFamily: "LatoBold",
  },
  preview: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
  },
  nameGroup: { gap: 8 },
  identityOptions: { gap: 8 },
  field: { gap: 4 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    aspectRatio: 1,
    minHeight: 32,
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "transparent",
  },
  symbol: { backgroundColor: tokens.surface },
  swatch: { width: "100%", height: "100%", borderRadius: 999 },
  selected: { borderColor: tokens.ink },
  selectedSwatch: { borderWidth: 3, borderColor: tokens.paper },
  label: { fontFamily: "Lato", fontSize: 14, color: tokens.ink },
  hint: {
    color: tokens.muted,
    fontFamily: "Lato",
    fontSize: 12,
    lineHeight: 18,
  },
  imageSection: { gap: 4 },
  imageRow: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  imageActions: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  banner: {
    width: 64,
    height: 48,
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: tokens.radius,
  },
});
