import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { Icon } from "../../components/Icon";
import { ViewportShell } from "../../components/ViewportShell";
import { DocumentEditor, type DocumentEditorHandle } from "../content/DocumentEditor";
import { EntryContent } from "../content/EntryContent";
import { ViewportToolbar } from "../../components/ViewportToolbar";
import { PopupMenu } from "../../components/PopupMenu";
import { DocumentAttachmentControls } from "../content/DocumentAttachmentControls";
import { useProject, useProjectEntry, useProjects, useProjectEntryManagement } from "../../hooks/useProjects";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { useContentDraft } from "../../hooks/useContentDraft";
import { useDocumentAttachments } from "../../hooks/useDocumentAttachments";
import { useDraftNavigation } from "../../hooks/useDraftNavigation";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import {
  materialDocument,
  hasProjectMaterial,
  entryBodyDocument,
  entryContentAfterRichBodyEdit,
} from "../../lib/materialNodes";
import type { ProjectEntry } from "../../lib/api/projectEntries";
import { layout } from "../../styles/layout";
import { entryMatchesPolicy, unrestrictedEntry, type EntryContentPolicy } from "../../lib/entryContentPolicy";
import { tokens } from "../../styles/tokens";

export function ProjectEntryScreen() {
  const { projectId, entryId } = useLocalSearchParams<{
    projectId: string;
    entryId?: string;
  }>();
  const project = useProject(projectId);
  const query = useProjectEntry(
    projectId,
    entryId,
    !project.error && Boolean(project.data?.can_add_material),
  );
  const router = useRouter();
  const navigation = useRoomNavigation();
  useEffect(() => {
    if (!entryId && query.query.data?.can_edit)
      router.replace(
        `/app/projects/${projectId}/entries/${query.query.data.id}/edit`,
      );
  }, [
    entryId,
    query.query.data?.id,
    query.query.data?.can_edit,
    projectId,
    router,
  ]);
  if (
    project.isLoading ||
    query.query.isLoading ||
    (!entryId && query.query.data)
  )
    return (
      <ViewportShell>
        <ActivityIndicator accessibilityLabel="Opening entry" />
      </ViewportShell>
    );
  if (project.error || query.query.error || !project.data)
    return (
      <ViewportShell>
        <View style={[layout.content, layout.section]}>
          <Text accessibilityRole="alert" style={layout.text}>
            Couldn’t open this entry.
          </Text>
          <Button
            onPress={() => {
              void Promise.all([project.mutate(), query.query.mutate()]).catch(
                () => {},
              );
            }}
          >
            Try again
          </Button>
          <Button
            emphasis="link"
            onPress={() => navigation.returnTo(`/app/projects/${projectId}`)}
          >
            Back to project
          </Button>
        </View>
      </ViewportShell>
    );
  if (!project.data.can_add_material || !query.query.data?.can_edit)
    return (
      <ViewportShell>
        <View style={[layout.content, layout.section]}>
          <Text style={layout.text}>
            You can edit your own entries while you are a project member.
          </Text>
          <Button
            onPress={() => navigation.returnTo(`/app/projects/${projectId}`)}
          >
            Back to project
          </Button>
        </View>
      </ViewportShell>
    );
  return (
    <ProjectEntryEditing
      key={query.query.data.id}
      projectId={projectId}
      name={project.data.name}
      entry={query.query.data}
      save={query.save}
      allowManagement
    />
  );
}
export function ProjectEntryEditing({
  projectId,
  room,
  name,
  headingIcon,
  entry,
  save,
  onPublish,
  returnPath,
  projectControl,
  editingLocked = false,
  policy = unrestrictedEntry,
  onFinished,
  completionLabel = "Share entry with Room",
  backLabel = "Back to project",
  allowManagement = false,
}: {
  allowManagement?: boolean;
  completionLabel?: string;
  backLabel?: string;
  policy?: EntryContentPolicy;
  onFinished?: () => void;
  editingLocked?: boolean;
  onPublish?: () => Promise<void>;
  returnPath?: string;
  projectControl?: import("react").ReactNode;
  projectId: string;
  room?: string;
  name: string;
  headingIcon?: import("react").ReactNode;
  entry: ProjectEntry;
  save: ReturnType<typeof useProjectEntry>["save"];
}) {
  const [initialVersion] = useState(() => Date.parse(entry.updated_at));
  const [initialContent] = useState(() => {
    const content = materialDocument(entry);
    return entry.lyrics
      ? {
          ...content,
          content: [
            ...(content.content || []),
            {
              type: "paragraph",
              content: [{ type: "text", text: entry.lyrics }],
            },
          ],
        }
      : content;
  });
  const [title, setTitle] = useState(entry.intent || "");
  const editor = useRef<DocumentEditorHandle>(null);
  const framing = useRef({ title, body: entry.question || "" });
  framing.current.title = title;
  const [error, setError] = useState<string>();
  const [finishing, setFinishing] = useState(false);
  const flight = useRef(false);
  const optionsAnchor = useRef<View>(null);
  const [options, setOptions] = useState(false);
  const [chooseProject, setChooseProject] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const projects = useProjects(undefined, chooseProject);
  const management = useProjectEntryManagement(projectId, entry.id);
  const router = useRouter();
  const savedRevision = useRef(initialVersion);
  const navigation = useRoomNavigation();
  const draft = useContentDraft({
    initialContent,
    initialVersion,
    autosave: !finishing,
    skipInitialSeed: false,
    onSave: async (content, baseVersion) => {
      const current = framing.current;
      const saved = await save.trigger({
        expected_revision: baseVersion,
        content,
        format: "mixed_media",
        format_data: entry.format_data || {},
        intent: current.title,
        question: current.body,
        lyrics: "",
        ...(hasProjectMaterial(content) ||
        current.title.trim() ||
        current.body.trim()
          ? { save: true }
          : {}),
      });
      savedRevision.current = Date.parse(saved.updated_at);
      return savedRevision.current;
    },
  });
  const reducedMotion = useReducedMotion();
  const saveOpacity = useRef(new Animated.Value(1)).current;
  const saving = draft.status === "saving";
  const saveError = draft.status && !["dirty", "saving"].includes(draft.status)
    ? draft.status
    : undefined;
  useEffect(() => {
    saveOpacity.setValue(1);
    if (!saving || reducedMotion) return;
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(saveOpacity, { toValue: 0.25, duration: 650, useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(saveOpacity, { toValue: 1, duration: 650, useNativeDriver: Platform.OS !== "web" }),
    ]));
    pulse.start();
    return () => { pulse.stop(); saveOpacity.setValue(1); };
  }, [saving, reducedMotion, saveOpacity]);
  const bodyContent = useMemo(() => entryBodyDocument(framing.current.body, draft.content), [draft.content, framing.current.body]);
  const currentDraft = useRef(draft);
  currentDraft.current = draft;
  const attachments = useDocumentAttachments(
    entry.id,
    async (node) => {
      const content = currentDraft.current.content;
      draft.handleChange({
        ...content,
        content: [...(content.content || []), node],
      });
    },
    setError,
    {
      target: "post",
      scope: `project-${projectId}-${entry.id}`,
      media: policy.media,
    },
  );
  const persist = async () => {
    // Flush the DOM bridge before navigation; retain the latest attachment changes.
    let content = currentDraft.current.content;
    if (editor.current) {
      const body = await editor.current.flush();
      content = currentDraft.current.content;
      if (JSON.stringify(body) !== JSON.stringify(entryBodyDocument(framing.current.body, content))) {
        framing.current.body = "";
        content = entryContentAfterRichBodyEdit(content, body);
        currentDraft.current.handleChange(content);
      }
    }
    await draft.saveNow(content);
  };
  const guard = useDraftNavigation({
    dirty: draft.dirty,
    protect: true,
    busy: finishing || attachments.pending,
    save: persist,
    onError: setError,
  });
  const finish = async (publish = false) => {
    if (flight.current || attachments.pending) return;
    flight.current = true;
    setFinishing(true);
    setError(undefined);
    try {
      await persist();
      if (publish && onPublish) {
        if (!entryMatchesPolicy({ content: currentDraft.current.content, format: "mixed_media", format_data: {}, intent: framing.current.title, question: framing.current.body, lyrics: "" }, policy))
          throw new Error(policy.requiredMedia ? `Add ${policy.requiredMedia} that fits this Round before submitting.` : "Add something before sharing.");
        await onPublish();
      }
      guard.release();
      if (onFinished) onFinished();
      else navigation.returnTo(returnPath || `/app/projects/${projectId}`);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save. Your edits are retained; try again.",
      );
    } finally {
      flight.current = false;
      setFinishing(false);
    }
  };
  const shareWithRoom = async () => {
    if (!allowManagement || flight.current || attachments.pending) return;
    flight.current = true;
    setFinishing(true);
    setOptions(false);
    setError(undefined);
    try {
      await persist();
      if (!entryMatchesPolicy({ content: currentDraft.current.content, format: "mixed_media", format_data: {}, intent: framing.current.title, question: framing.current.body, lyrics: "" }, unrestrictedEntry))
        throw new Error("Add something before sharing.");
      guard.release();
      navigation.destination(`/app/projects/${projectId}/entries/${entry.id}/share`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save before sharing. Try again.");
    } finally {
      flight.current = false;
      setFinishing(false);
    }
  };
  const manage = async (destination: number | null) => {
    if (!allowManagement || flight.current || attachments.pending) return;
    flight.current = true;
    setFinishing(true);
    setError(undefined);
    try {
      await persist();
      await management.trigger({ destination, revision: savedRevision.current });
      guard.release();
      if (destination === null) navigation.returnTo(`/app/projects/${projectId}`);
      else router.replace(`/app/projects/${destination}/entries/${entry.id}/edit`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change this entry. Try again.");
    } finally {
      flight.current = false;
      setFinishing(false);
      setChooseProject(false);
      setConfirmDelete(false);
    }
  };
  return (
    <ViewportShell suppressAudioPlayer surface={tokens.paper}>
      <View style={[layout.content, layout.appBar]}>
        <Button
          size="icon"
          emphasis="bare"
          hitSlop={7}
          accessibilityLabel={backLabel}
          disabled={finishing || attachments.pending}
          onPress={() => {
            void finish();
          }}
        >
          <Icon name="caretCircleLeft" size={28} />
        </Button>
        <View style={styles.projectHeading}>
          {headingIcon && <View style={styles.headingIcon}>{headingIcon}</View>}
          <Text
            numberOfLines={1}
            accessibilityRole="header"
            ellipsizeMode="tail"
            style={[layout.appBarTitle, styles.projectName]}
          >
            {name}
          </Text>
          <View
            accessibilityLiveRegion="polite"
            accessibilityLabel={saving ? "Saving" : draft.dirty ? "Unsaved changes" : "Saved"}
            style={styles.saveIndicator}
          >
            <Animated.View style={[styles.saveGlyph, { opacity: draft.dirty || saving ? saveOpacity : 0 }]}>
              <Icon name="dot" size={48} color={tokens.muted} />
            </Animated.View>
          </View>
        </View>
        {allowManagement && <Button
          emphasis="bare"
          size="icon"
          ref={optionsAnchor}
          accessibilityLabel="Entry options"
          onPress={() => setOptions(true)}
        >
          <Icon name="dotsThree" size={24} />
        </Button>}
        <Button
          shape="circle"
          hitSlop={7}
          accessibilityLabel={onPublish ? completionLabel : "Done editing"}
          disabled={finishing || attachments.pending || Boolean(onPublish && !entryMatchesPolicy({ content: draft.content, format: "mixed_media", format_data: {}, intent: title, question: framing.current.body, lyrics: "" }, policy))}
          onPress={() => {
            void finish(true);
          }}
        >
          <Icon name="checkBold" size={24} color={tokens.paper} />
        </Button>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[layout.content, styles.composition]}
      >
        {projectControl}
        <EntryContent
          compactSingleAudio
          entry={{
            content: {
              ...draft.content,
              content: (draft.content.content || []).filter((node) =>
                ["image", "audio", "video"].includes(node.type),
              ),
            },
            format: "mixed_media",
            format_data: {},
          }}
          onMediaRemove={
            finishing || attachments.pending || editingLocked
              ? undefined
              : (index) => {
                  const target = (draft.content.content || []).filter((node) =>
                    ["image", "audio", "video"].includes(node.type),
                  )[index];
                  draft.handleChange({
                    ...draft.content,
                    content: (draft.content.content || []).filter(
                      (node) => node !== target,
                    ),
                  });
                }
          }
        />
        {(policy.title ?? policy.text) && <Input
          accessibilityLabel="Title"
          placeholder="Title"
          value={title}
          maxLength={2000}
          editable={!finishing && !editingLocked}
          style={styles.title}
          onChangeText={(value) => {
            framing.current.title = value;
            setTitle(value);
            draft.markDirty();
          }}
        />}
        {policy.text && <DocumentEditor
          ref={editor}
          accessibilityLabel="Body"
          toolbarMode="bubble"
          room={room}
          content={bodyContent}
          disabled={finishing || editingLocked}
          onChange={(body) => {
            framing.current.body = "";
            const content = entryContentAfterRichBodyEdit(currentDraft.current.content, body);
            currentDraft.current.handleChange(content);
          }}
        />}
      </ScrollView>
      <ViewportToolbar>
        <View>
          {(error || saveError) && (
            <View pointerEvents="box-none" style={styles.noticePosition}>
              <View style={layout.content}>
                <Text accessibilityRole="alert" style={[layout.text, styles.notice]}>
                  {error || saveError}
                </Text>
              </View>
            </View>
          )}
          <DocumentAttachmentControls
            attachments={attachments}
            disabled={finishing || editingLocked}
            media={policy.media}
          />
        </View>
      </ViewportToolbar>
      <PopupMenu
        mode="menu"
        open={options}
        title="Entry options"
        anchor={optionsAnchor}
        onClose={() => setOptions(false)}
        actions={[
          {
            id: "share",
            label: "Share with a room",
            disabled: finishing || editingLocked || attachments.pending,
            onSelect: () => { void shareWithRoom(); },
          },
          {
            id: "choose-project",
            label: "Choose project",
            disabled: finishing || editingLocked || attachments.pending,
            onSelect: () => { setOptions(false); setChooseProject(true); },
          },
          {
            id: "delete",
            label: "Delete",
            disabled: finishing || editingLocked || attachments.pending,
            onSelect: () => { setOptions(false); setConfirmDelete(true); },
          },
        ]}
      />
      <PopupMenu mode="dialog" open={chooseProject} title="Choose project"
        dismissDisabled={finishing} onClose={() => setChooseProject(false)}
        actions={(projects.data?.projects || [])
          .filter(project => project.viewer_participation === "owner" || project.viewer_participation === "accepted")
          .map(project => ({
            id: String(project.id), label: project.name,
            selected: String(project.id) === projectId,
            disabled: finishing || String(project.id) === projectId,
            onSelect: () => { void manage(project.id); },
          }))}>
        {projects.isLoading && <ActivityIndicator accessibilityLabel="Loading projects" />}
        {projects.error && <Button emphasis="link" onPress={() => { void projects.mutate(); }}>Retry projects</Button>}
        {projects.hasMore && <Button emphasis="link" onPress={() => { void projects.loadMore(); }}>More projects</Button>}
      </PopupMenu>
      <PopupMenu mode="dialog" open={confirmDelete} title="Delete entry?"
        dismissDisabled={finishing} onClose={() => setConfirmDelete(false)}
        actions={[
          { id: "cancel", label: "Cancel", disabled: finishing, onSelect: () => setConfirmDelete(false) },
          { id: "delete", label: "Delete entry", disabled: finishing, onSelect: () => { void manage(null); } },
        ]}>
        <Text style={layout.text}>Delete this entry from this project? Copies already shared with Rooms will remain.</Text>
      </PopupMenu>
    </ViewportShell>
  );
}
const styles = StyleSheet.create({
  headingIcon: { marginRight: 8 },
  projectHeading: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" },
  projectName: { flex: 0, flexBasis: "auto", flexShrink: 1 },
  // The library dot fills 24/256 of its SVG: 48px yields a 4.5px dot.
  // Previous visible gap was 8/2 - 2.25/2 = 2.875px; triple it here.
  saveIndicator: { width: 4.5, height: 24, marginLeft: 8.625, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  saveGlyph: { width: 48, height: 48, flexShrink: 0 },
  noticePosition: { position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 8, zIndex: 1 },
  notice: { padding: 12, backgroundColor: tokens.surface, borderColor: tokens.border, borderWidth: 1, borderRadius: 12 },
  composition: { paddingVertical: 12, gap: 8 },
  header: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    height: 44,
    flexShrink: 0,
  },
  title: {
    fontFamily: "LatoBold",
    fontSize: 20,
    paddingHorizontal: 0,
    paddingVertical: 4,
    borderWidth: 0,
    backgroundColor: "transparent",
  },
});
