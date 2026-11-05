import { RoomEntryFlow } from "../projects/RoomEntryScreen";
import { useRoundContributionNavigation } from "../../hooks/useRoundContributionNavigation";
import { PageScrollView } from "../../components/PageScrollView";
import { useEffect, useRef, useState } from "react";
import {
  Platform,
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { PopupMenu } from "../../components/PopupMenu";
import { Input } from "../../components/Input";
import { EntryContent } from "../content/EntryContent";
import { materialDocument } from "../../lib/materialDocument";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { ViewportShell } from "../../components/ViewportShell";
import { ViewportToolbar } from "../../components/ViewportToolbar";
import { ProjectIcon } from "../projects/ProjectIcon";
import { tokens } from "../../styles/tokens";
import {
  DocumentEditor,
  type DocumentEditorHandle,
} from "../content/DocumentEditor";
import { DocumentContent } from "../content/DocumentContent";
import {
  useRoundContribution,
  useRoundProjectEntries,
} from "../../hooks/useRoundContribution";
import { useContentDraft } from "../../hooks/useContentDraft";
import { useDraftNavigation } from "../../hooks/useDraftNavigation";
import { useDocumentAttachments } from "../../hooks/useDocumentAttachments";
import { DocumentAttachmentControls } from "../content/DocumentAttachmentControls";
import type { RoundDetail } from "../../lib/api/rounds";
import {
  entryMatchesPolicy,
  imageOnlyEntry,
  unrestrictedEntry,
  type EntryContentPolicy,
} from "../../lib/entryContentPolicy";
import { defaultTiptapDoc } from "../../lib/tiptap";
import { layout } from "../../styles/layout";

type Kind = "cover" | "response" | "submission";
export function RoundContribution({
  detail,
  kind,
  done,
  existingDraft,
  initialMode = "choose",
}: {
  existingDraft?: string;
  initialMode?: "choose" | "new" | "project";
  detail: RoundDetail;
  kind: Kind;
  done: () => void;
}) {
  const contributionNavigation = useRoundContributionNavigation();
  const source = contributionNavigation.mode === "choose" ? initialMode : contributionNavigation.mode;
  const setSource = contributionNavigation.setMode;
  const [project, setProject] = useState<number>();
  const existing = existingDraft ?? contributionNavigation.draft;
  const [error, setError] = useState<string>();
  const projects = useRoundProjectEntries(project, detail, kind);
  const config = detail.roundState?.config;
  const policy: EntryContentPolicy =
    kind === "cover"
      ? imageOnlyEntry
      : kind === "submission"
        ? unrestrictedEntry
        : {
            media:
              config?.responseFormat === "any"
                ? ["image", "audio", "video"]
                : ["audio"],
            text: config?.responseFormat !== "audio",
            title: true,
            requiredMedia:
              config?.responseFormat === "audio" ? "audio" : undefined,
          };
  if (source === "new" && !existing)
    return <RoomEntryFlow room={String(detail.round.roomId)} done={done} policy={policy}
      context={<ContributionContext detail={detail} kind={kind} />}
      shareInput={{ room_id: Number(detail.round.roomId), round_id: Number(detail.round.id),
        ...(kind === "cover" ? { creation_origin: "round_activity_cover" } : kind === "response" ? { creation_origin: "round_activity_response" } : {}),
      }} />;
  if (existing)
    return (
      <ContributionEditing
        key={existing || "new"}
        detail={detail}
        kind={kind}
        existing={existing}
        policy={policy}
        done={done}
      />
    );
  const eligible =
    projects.projects.data?.projects.filter(
      (item) =>
        item.viewer_participation === "owner",
    ) ?? [];
  const selected = eligible.find((item) => item.id === project);
  const entries =
    projects.entries.data?.entries.filter(
      (entry) =>
        entry.kind === "material" &&
        !entry.draft &&
        entry.can_share &&
        entryMatchesPolicy(entry, policy),
    ) ?? [];
  const back = () => {
    if (project) {
      setProject(undefined);
      setError(undefined);
    } else done();
  };
  return (
    <ViewportShell>
      <View style={layout.content}>
        <View style={styles.header}>
          <Button
            size="icon"
            emphasis="bare"
            accessibilityLabel={project ? "Back to projects" : "Back to round"}
            disabled={projects.share.isMutating}
            onPress={back}
          >
            <Icon name="caretCircleLeft" size={28} />
          </Button>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            ellipsizeMode="tail"
            style={layout.appBarTitle}
          >
            {source === "project" ? "Share" : "Round"}
          </Text>
          <View style={{ width: 44 }} />
        </View>
      </View>
      <PageScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.flow]}
      >
        <ContributionContext detail={detail} kind={kind} />
        {source === "choose" ? (
          <>
            <Button
              emphasis="bare"
              style={styles.useProject}
              onPress={() => setSource("project")}
            >
              Share from project
            </Button>
            <ViewportToolbar>
              <View style={styles.fabRow}>
                <Button
                  emphasis="bare"
                  accessibilityLabel="Share something new"
                  style={styles.fab}
                  onPress={() => setSource("new")}
                >
                  <Icon name="plusBold" size={24} color={tokens.paper} />
                </Button>
              </View>
            </ViewportToolbar>
          </>
        ) : (
          <>
            <View style={layout.row}>
              {selected ? (
                <Button
                  emphasis="bare"
                  style={styles.selectedProject}
                  onPress={() => setProject(undefined)}
                >
                  <ProjectIcon
                    name={selected.name}
                    imageUrl={selected.icon_url}
                    symbol={selected.icon_symbol}
                    themeColor={selected.icon_color}
                  />
                  <Text style={layout.text}>{selected.name}</Text>
                </Button>
              ) : (
                <Text accessibilityRole="header" style={styles.sectionTitle}>
                  Projects
                </Text>
              )}
              <Button
                emphasis="bare"
                accessibilityLabel="Share something"
                style={layout.row}
                onPress={() => setSource("new")}
              >
                <Icon name="plusBold" size={14} />
                <Text style={layout.text}>New</Text>
              </Button>
            </View>
            {!project ? (
              <>
                {projects.projects.isLoading && (
                  <ActivityIndicator accessibilityLabel="Loading projects" />
                )}
                {projects.projects.error && (
                  <Button
                    onPress={() => {
                      void projects.projects.mutate().catch(() => {});
                    }}
                  >
                    Retry projects
                  </Button>
                )}
                <View style={styles.projects}>
                  {eligible.map((item) => (
                    <Button
                      key={item.id}
                      style={styles.projectRow}
                      emphasis="bare"
                      onPress={() => setProject(item.id)}
                    >
                      <ProjectIcon
                        name={item.name}
                        imageUrl={item.icon_url}
                        symbol={item.icon_symbol}
                        themeColor={item.icon_color}
                        size={28}
                      />
                      <Text style={[styles.projectName, layout.grow]}>
                        {item.name}
                      </Text>
                      <Icon name="caretRight" size={16} />
                    </Button>
                  ))}
                </View>
                {projects.projects.hasMore && <Button disabled={projects.projects.isValidating} onPress={() => void projects.projects.loadMore().catch(() => {})}>Load more projects</Button>}
                {!projects.projects.isLoading && !projects.projects.hasMore &&
                  !projects.projects.error &&
                  !eligible.length && (
                    <Text style={layout.text}>
                      No projects yet. Share something new.
                    </Text>
                  )}
                <Text style={styles.sharingNote}>
                  Choose something from a project to share a separate copy with the Room. Your
                  project stays private.
                </Text>
              </>
            ) : (
              <>
                {projects.entries.isLoading && (
                  <ActivityIndicator accessibilityLabel="Loading project content" />
                )}
                {projects.entries.error && (
                  <Button
                    onPress={() => {
                      void projects.entries.mutate().catch(() => {});
                    }}
                  >
                    Try loading again
                  </Button>
                )}
                {entries.map((entry) => (
                  <View key={entry.id} style={styles.entry}>
                    <EntryContent
                      entry={{
                        content: materialDocument(entry),
                        format: "mixed_media",
                        format_data: {
                          ...entry.format_data,
                          title: entry.intent || entry.format_data?.title,
                        },
                      }}
                    />
                    <Button
                      shape="pill"
                      color={tokens.aqua}
                      disabled={projects.share.isMutating}
                      onPress={() => {
                        setError(undefined);
                        void projects.share
                          .trigger(entry)
                          .then((result) => contributionNavigation.setDraft(String(result.entry_id)))
                          .catch((reason) =>
                            setError(
                              reason instanceof Error
                                ? reason.message
                                : "Could not prepare your work for sharing. Try again.",
                            ),
                          );
                      }}
                    >
                      {projects.share.isMutating
                        ? "Preparing copy…"
                        : "Choose this"}
                    </Button>
                  </View>
                ))}
                {projects.hasMore && <Button disabled={projects.entries.isValidating} onPress={() => { void projects.entries.setSize(projects.entries.size + 1).catch(() => {}); }}>Load more</Button>}
                {projects.entries.data && !projects.hasMore && !projects.entries.isLoading && !projects.entries.error && !entries.length && (
                  <Text style={layout.muted}>
                    Nothing in this project matches this phase. Choose another project or share
                    something new.
                  </Text>
                )}
              </>
            )}
          </>
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
function ContributionContext({
  detail,
  kind,
}: {
  detail: RoundDetail;
  kind: Kind;
}) {
  const cover =
    kind === "response" ? detail.roundState?.viewer.chosenCover : undefined;
  return (
    <View style={styles.context}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {detail.round.name}
      </Text>
      {Boolean(detail.round.prompt?.trim()) && (
        <Text style={layout.text}>{detail.round.prompt}</Text>
      )}
      {cover && (
        <View style={styles.sourceMaterial}>
          <Text style={styles.sectionTitle}>Your chosen cover</Text>
          <EntryContent
            entry={{
              content: {
                type: "doc",
                content: [
                  {
                    type: "image",
                    attrs: { src: cover.imageUrl, alt: cover.alt },
                  },
                ],
              },
              format: "mixed_media",
              format_data: null,
            }}
          />
        </View>
      )}
    </View>
  );
}
function ContributionEditing({
  detail,
  kind,
  existing,
  policy,
  done,
}: {
  detail: RoundDetail;
  kind: Kind;
  existing: string;
  policy: EntryContentPolicy;
  done: () => void;
}) {
  const query = useRoundContribution(detail, kind, existing);
  return (
    <EntryContributionEditor
      query={query}
      detail={detail}
      kind={kind}
      policy={policy}
      done={done}
    />
  );
}
export function EntryContributionEditor({
  query,
  detail,
  kind = "submission",
  policy = unrestrictedEntry,
  done,
}: {
  query: Pick<
    ReturnType<typeof useRoundContribution>,
    "draft" | "save" | "busy" | "submit"
  >;
  detail?: RoundDetail;
  kind?: Kind;
  policy?: EntryContentPolicy;
  done: () => void;
}) {
  const editor = useRef<DocumentEditorHandle>(null);
  const [title, setTitle] = useState("");
  const titleRef = useRef(title);
  titleRef.current = title;
  const initialized = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (query.draft.data && initialized.current !== query.draft.data.id) {
      initialized.current = query.draft.data.id;
      setTitle(query.draft.data.format_data?.title || "");
    }
  }, [query.draft.data]);
  const initialSnapshot = useRef<{ id: number; content: ReturnType<typeof materialDocument>; revision: number } | null>(null);
  if (query.draft.data && initialSnapshot.current?.id !== query.draft.data.id) {
    initialSnapshot.current = { id: query.draft.data.id, content: materialDocument(query.draft.data), revision: query.draft.data.revision ?? 0 };
  }
  const draft = useContentDraft({
    initialContent: initialSnapshot.current?.content ?? defaultTiptapDoc,
    initialVersion: initialSnapshot.current?.revision,
    onSave: query.draft.data
      ? async (content, baseVersion) => {
          const saved = await query.save.trigger({ content, title: titleRef.current, expectedRevision: baseVersion ?? 0 });
          return saved.revision ?? 0;
        }
      : undefined,
    skipInitialSeed: false,
    autosaveDelayMs: 1000,
  });
  const [error, setError] = useState<string>();
  const [committing, setCommitting] = useState(false);
  const committingRef = useRef(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsRef = useRef<View>(null);
  const current = useRef(draft);
  current.current = draft;
  const attachments = useDocumentAttachments(
    query.draft.data?.id,
    async (node) => {
      const content =
        (await editor.current?.flush()) ?? current.current.content;
      draft.handleChange({
        ...content,
        content: [...(content.content || []), node],
      });
    },
    setError,
    {
      target: "post",
      scope: `entry-${query.draft.data?.id}-${kind}`,
      media: policy.media,
    },
  );
  const busy = committing || query.busy || attachments.busy;
  const persist = async () => {
    const content = (await editor.current?.flush()) ?? current.current.content;
    await draft.saveNow(content);
  };
  const guard = useDraftNavigation({
    protect: true,
    dirty: draft.dirty,
    busy: busy || attachments.pending,
    save: persist,
    onError: setError,
  });
  const compatible = entryMatchesPolicy(
    { content: draft.content, format: "mixed_media", format_data: { title } },
    policy,
  );
  const finish = async (publish: boolean) => {
    if (
      committingRef.current ||
      query.busy ||
      attachments.busy ||
      attachments.pending
    )
      return;
    committingRef.current = true;
    setCommitting(true);
    setError(undefined);
    try {
      if (publish) await query.submit(persist);
      else await persist();
      guard.release();
      done();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save. Your draft is retained.",
      );
    } finally {
      committingRef.current = false;
      setCommitting(false);
    }
  };
  if (query.draft.isLoading)
    return <ActivityIndicator accessibilityLabel="Preparing contribution" />;
  if (query.draft.error)
    return (
      <Button
        style={styles.target}
        onPress={() => {
          void query.draft.mutate().catch(() => {});
        }}
      >
        Retry contribution
      </Button>
    );
  const saveAndClose = () => {
    void finish(false);
  };
  const submitLabel =
    kind === "cover"
      ? "Add cover"
      : kind === "response"
        ? "Share response"
        : "Share";
  return (
    <ViewportShell suppressAudioPlayer surface={tokens.paper}>
      <View style={layout.content}>
        <View style={styles.editorHeader}>
          <Button
            size="icon"
            emphasis="bare"
            accessibilityLabel="Save draft and go back"
            disabled={busy || attachments.pending}
            onPress={saveAndClose}
            style={styles.iconControl}
          >
            <Icon name="caretCircleLeft" size={28} />
          </Button>
          <Text
            accessibilityRole="header"
            aria-level={Platform.OS === "web" ? 2 : undefined}
            numberOfLines={1}
            style={[styles.headerTitle, layout.grow]}
          >
            Share something
          </Text>
          <Button
            ref={optionsRef}
            emphasis="bare"
            accessibilityLabel="Sharing options"
            hasPopup
            expanded={optionsOpen}
            style={styles.iconControl}
            onPress={() => setOptionsOpen(true)}
          >
            <Icon name="dotsThree" size={24} />
          </Button>
          <Button
            accessibilityLabel={
              detail ? "Publish Round contribution" : "Share"
            }
            shape="pill"
            color={tokens.aqua}
            style={styles.publish}
            disabled={busy || !compatible || attachments.pending}
            onPress={() => {
              void finish(true);
            }}
          >
            {busy ? "Saving…" : submitLabel}
          </Button>
        </View>
      </View>
      <PopupMenu
        mode="menu"
        open={optionsOpen}
        title="Sharing options"
        anchor={optionsRef}
        dismissDisabled={busy}
        onClose={() => setOptionsOpen(false)}
        actions={[
          ...((policy.title ?? policy.text)
            ? [
                {
                  id: "clear-title",
                  label: "Clear title",
                  disabled: busy || !title,
                  onSelect: () => {
                    titleRef.current = "";
                    setTitle("");
                    draft.markDirty();
                    setOptionsOpen(false);
                  },
                },
              ]
            : []),
          {
            id: "save-draft",
            label: "Save draft and close",
            disabled: busy || attachments.pending,
            onSelect: () => {
              setOptionsOpen(false);
              saveAndClose();
            },
          },
        ]}
      />
      <PageScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.flow]}
      >
        {detail && <ContributionContext detail={detail} kind={kind} />}
        {(policy.title ?? policy.text) && (
          <Input
            accessibilityLabel="Title"
            placeholder="Title"
            maxLength={2000}
            style={styles.titleInput}
            value={title}
            editable={!busy}
            onChangeText={(value) => {
              titleRef.current = value;
              setTitle(value);
              draft.markDirty();
            }}
          />
        )}
        {policy.text ? (
          <DocumentEditor
            toolbarMode="bubble"
            ref={editor}
            room={
              detail?.round.roomId ?? query.draft.data?.room_id
            }
            content={draft.content}
            onChange={draft.handleChange}
            disabled={busy}
          />
        ) : (
          <DocumentContent content={draft.content} />
        )}

        {error && (
          <Text accessibilityRole="alert" style={layout.text}>
            {error}
          </Text>
        )}
        {draft.status && (
          <Text accessibilityLiveRegion="polite" style={layout.muted}>
            {draft.status === "saving"
              ? "Saving…"
              : draft.status === "dirty"
                ? "Unsaved changes"
                : draft.status}
          </Text>
        )}
      </PageScrollView>
      <ViewportToolbar>
        <View>
          <DocumentAttachmentControls
            attachments={attachments}
            disabled={committing || query.busy || !query.draft.data}
            media={policy.media}
          />
        </View>
      </ViewportToolbar>
    </ViewportShell>
  );
}
const styles = StyleSheet.create({
  flow: { gap: 16 },
  editorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 56,
  },
  iconControl: {
    width: 40,
    minWidth: 40,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  publish: { minHeight: 32, paddingHorizontal: 12, paddingVertical: 4 },
  titleInput: {
    paddingHorizontal: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    fontSize: 20,
    fontFamily: "LatoBold",
  },
  header: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: { fontFamily: "BarlowCondensedBold", fontSize: 18, color: tokens.ink },
  sectionTitle: { fontFamily: "LatoBold", fontSize: 18, color: tokens.ink },
  context: { gap: 8, marginTop: 8, marginBottom: 24 },
  sourceMaterial: { maxWidth: 320, gap: 8 },
  useProject: { alignSelf: "flex-start" },
  fabRow: { alignItems: "flex-end", paddingTop: 16, paddingHorizontal: 16 },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    padding: 0,
    backgroundColor: tokens.projectEntryAction,
  },
  selectedProject: { flexDirection: "row", gap: 8, flexShrink: 1 },
  projects: {
    backgroundColor: tokens.paper,
    borderRadius: 16,
    paddingHorizontal: 4,
  },
  projectRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border,
  },
  projectName: { fontFamily: "Lato", fontSize: 18, color: tokens.ink },
  sharingNote: {
    fontFamily: "Lato",
    fontSize: 14,
    lineHeight: 21,
    color: tokens.inkMuted,
    margin: 8,
  },
  entry: {
    backgroundColor: tokens.paper,
    borderRadius: 16,
    padding: 8,
    gap: 16,
  },
  target: { minHeight: 48, minWidth: 48 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
