import { Toast } from "../../components/Toast";
import { PageScrollView } from "../../components/PageScrollView";
import { PopupMenu } from "../../components/PopupMenu";
import { Icon } from "../../components/Icon";
import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { ViewportShell } from "../../components/ViewportShell";
import {
  DocumentEditor,
  type DocumentEditorHandle,
} from "../content/DocumentEditor";
import { DocumentNoteContext } from "../content/DocumentContext";
import { DocumentMedia } from "../content/DocumentMedia";
import { findDocumentBlock } from "../../lib/documentNodeIdentity";
import { normalizeAudioSeconds } from "../../lib/audioTimestamp";
import { DocumentContent } from "../content/DocumentContent";
import { useNote, useNoteBlockTransfer } from "../../hooks/useNotes";
import { useContentDraft } from "../../hooks/useContentDraft";
import { useDraftNavigation } from "../../hooks/useDraftNavigation";
import { useDocumentAttachments } from "../../hooks/useDocumentAttachments";
import { DocumentAttachmentControls } from "../content/DocumentAttachmentControls";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { NoteTree } from "./NoteTree";
import type { SelectedPageBlocks } from "../../lib/moveNoteBlocks";
import type { Note } from "../../lib/api/notes";
import { sanitizeNoteIcon } from "../../lib/noteIcon";
import { shareAppLink } from "../../lib/shareLink";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";
import { ApiError } from "../../lib/api/transport";
export function NoteScreen() {
  const { pageId } = useLocalSearchParams<{ pageId: string }>();
  const query = useNote(pageId);
  const navigation = useRoomNavigation();
  const denied =
    query.query.error instanceof ApiError &&
    [401, 403, 404].includes(query.query.error.status);
  if (query.query.isLoading || denied || !query.query.data)
    return (
      <ViewportShell>
        <View style={[layout.content, layout.section]}>
          <Button
            emphasis="ghost"
            accessibilityLabel="Back"
            onPress={() => navigation.returnTo()}
          >
            <Icon name="caretLeft" size={24} />
          </Button>
          {query.query.isLoading ? (
            <ActivityIndicator accessibilityLabel="Loading note" />
          ) : (
            <>
              <Text accessibilityRole="alert" style={layout.text}>
                This note is unavailable or you no longer have access.
              </Text>
              <Button
                onPress={() => {
                  void query.query.mutate().catch(() => {});
                }}
              >
                Retry note
              </Button>
            </>
          )}
        </View>
      </ViewportShell>
    );
  return <NoteEditing key={pageId} note={query.query.data} query={query} />;
}
function NoteEditing({
  note,
  query,
}: {
  note: Note;
  query: ReturnType<typeof useNote>;
}) {
  const navigation = useRoomNavigation();
  const params = useLocalSearchParams<{
    audio?: string;
    audioNode?: string;
    t?: string;
    "#": string;
  }>();
  const linkedNode = params["#"]
    ? findDocumentBlock(note.content.content, params["#"].replace(/^#/, ""))
    : undefined;
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionAnchor = useRef<View>(null);
  const editor = useRef<DocumentEditorHandle>(null);
  const [title, setTitle] = useState(note.title || "");
  const [icon, setIcon] = useState(note.icon || "");
  const [metaDirty, setMetaDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [preview, setPreview] = useState(false);
  const operation = useRef(false);
  const [operating, setOperating] = useState(false);
  const moveSource = useRef("");
  const [selectedBlocks, setSelectedBlocks] =
    useState<SelectedPageBlocks | null>(null);
  const [transferAttempted, setTransferAttempted] = useState(false);
  const transfer = useNoteBlockTransfer(
    note.room_id,
    Boolean(selectedBlocks),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const draft = useContentDraft({
    initialContent: note.content,
    initialVersion: note.version ?? 0,
    onSave: async (content, version) => {
      const saved = await query.content.trigger({ content, version: version ?? 0 });
      return saved.version ?? undefined;
    },
    autosaveDelayMs: 1000,
    skipInitialSeed: false,
  });
  const attachments = useDocumentAttachments(
    note.id,
    async (node) => {
      const content =
        (await editor.current?.flush()) ?? current.current.draft.content;
      draft.handleChange({
        ...content,
        content: [...(content.content || []), node],
      });
    },
    setError,
  );
  const busy =
    operating ||
    query.child.isMutating ||
    query.remove.isMutating ||
    attachments.busy;
  const current = useRef({ draft, title, icon, metaDirty });
  current.current = { draft, title, icon, metaDirty };
  useEffect(() => {
    if (!metaDirty) {
      setTitle(note.title || "");
      setIcon(note.icon || "");
    }
  }, [note.title, note.icon, metaDirty]);
  const save = async () => {
    const flushed = await editor.current?.flush();
    const value = current.current;
    if (value.metaDirty) {
      await query.meta.trigger({
        title: value.title.trim() || null,
        icon: value.icon.trim() || null,
      });
      if (
        current.current.title === value.title &&
        current.current.icon === value.icon
      )
        setMetaDirty(false);
    }
    if (
      value.draft.dirty ||
      (flushed &&
        JSON.stringify(flushed) !== JSON.stringify(value.draft.content))
    )
      await value.draft.saveNow(flushed ?? value.draft.content);
    setError(undefined);
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!metaDirty) return;
    const timeout = setTimeout(() => {
      void saveRef
        .current()
        .catch((reason) =>
          setError(
            reason instanceof Error ? reason.message : "Could not save.",
          ),
        );
    }, 1000);
    return () => clearTimeout(timeout);
  }, [metaDirty, title, icon]);
  const navigationGuard = useDraftNavigation({
    protect: !preview,
    dirty: metaDirty || draft.dirty,
    busy: busy || attachments.pending,
    save,
    onError: setError,
  });
  // Lock before the asynchronous editor flush; mutation state starts too late to
  // prevent double taps from creating two children or deleting twice.
  const runOperation = async (work: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true;
    setOperating(true);
    setError(undefined);
    try {
      await work();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not finish. Try again.",
      );
    } finally {
      operation.current = false;
      setOperating(false);
    }
  };
  const leave = async () => {
    try {
      await save();
      navigation.returnTo(
        note.parent_id
          ? `/app/note/${note.parent_id}`
          : `/app/rooms/${note.room_id}/notes`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not save. Try again.",
      );
    }
  };
  const chooseMove = async () => {
    if (busy || !editor.current) return;
    try {
      const snapshot = await editor.current.inspect();
      if (!snapshot.selection) {
        setNotice("Place the cursor in a block or select text first.");
        return;
      }
      await draft.saveNow(snapshot.content);
      moveSource.current = JSON.stringify(snapshot.content);
      setSelectedBlocks(snapshot.selection);
      setTransferAttempted(false);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not select blocks.",
      );
    }
  };
  const move = async (target: number) => {
    if (!selectedBlocks || transferAttempted || operation.current) return;
    const selection = selectedBlocks;
    await runOperation(async () => {
      if (
        !editor.current ||
        JSON.stringify(await editor.current.flush()) !== moveSource.current
      )
        throw new Error(
          "The source changed. Close the move and select the blocks again.",
        );
      setTransferAttempted(true);
      // Never repeat an uncertain append automatically: the destination may have
      // committed even if its response was lost. Source content stays intact.
      try {
        await transfer.copy.trigger({ target, blocks: selection.blocks });
      } catch {
        throw new Error(
          "Could not confirm the copy. Your source is unchanged. Check the destination Note before trying again.",
        );
      }
      if (!editor.current)
        throw new Error(
          "Blocks were copied. Reopen the source to remove them.",
        );
      const next = await editor.current.removeBlocks(selection);
      draft.handleChange(next);
      await draft.saveNow(next);
      setSelectedBlocks(null);
      setNotice("Blocks moved.");
    });
  };
  return (
    <DocumentNoteContext.Provider value={String(note.id)}>
      <ViewportShell suppressAudioPlayer={!preview}>
        <PageScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content]}
        >
          {query.query.error && (
            <View style={layout.section}>
              <Text accessibilityRole="alert" style={layout.text}>
                Could not refresh this Note. Your unsaved changes are retained.
              </Text>
              <Button
                style={styles.target}
                onPress={() => {
                  void query.query.mutate().catch(() => {});
                }}
              >
                Retry note
              </Button>
            </View>
          )}
          <View style={[styles.wrap, { justifyContent: "space-between" }]}>
            <Button
              style={styles.target}
              emphasis="ghost"
              disabled={busy || attachments.pending}
              onPress={() => {
                void leave();
              }}
              accessibilityLabel="Back"
            >
              <Icon name="caretLeft" size={24} />
            </Button>
            <View style={layout.grow} />
            {preview && (
              <Button emphasis="bare" onPress={() => setPreview(false)}>
                Edit note
              </Button>
            )}
            <Button
              ref={actionAnchor}
              hasPopup
              expanded={actionsOpen}
              emphasis="bare"
              accessibilityLabel="Note actions"
              onPress={() => setActionsOpen(true)}
            >
              <Icon name="dotsThree" size={24} />
            </Button>
          </View>
          {params.audio && /^[1-9]\d*$/.test(params.audio) && (
            <DocumentMedia
              node={{
                type: "audioTimestamp",
                attrs: {
                  audioAssetId: params.audio,
                  audioNodeId: params.audioNode,
                  seconds: normalizeAudioSeconds(params.t),
                },
              }}
            />
          )}
          {linkedNode && (
            <View style={layout.section}>
              <Text accessibilityRole="header" style={layout.title}>
                Linked content
              </Text>
              <DocumentContent
                content={{ type: "doc", content: [linkedNode] }}
              />
            </View>
          )}
          <View style={styles.metadata}>
            <View style={styles.iconField}>
              {!icon && (
                <View pointerEvents="none" style={styles.iconPlaceholder}>
                  <Icon name="plus" size={16} />
                </View>
              )}
              <Input
                style={styles.iconInput}
                accessibilityLabel="Note icon"
                placeholder=""
                value={icon}
                editable={!busy}
                onChangeText={(value) => {
                  setIcon(sanitizeNoteIcon(value));
                  setMetaDirty(true);
                }}
              />
            </View>
            <Input
              style={styles.titleInput}
              accessibilityLabel="Note title"
              placeholder="Untitled note"
              value={title}
              editable={!busy}
              onChangeText={(value) => {
                setTitle(value);
                setMetaDirty(true);
              }}
            />
          </View>
          {error && (
            <Text accessibilityRole="alert" style={layout.text}>
              {error}
            </Text>
          )}
          <Text
            accessibilityLiveRegion="polite"
            style={[
              layout.muted,
              !draft.dirty &&
                !metaDirty &&
                !query.meta.isMutating &&
                styles.saved,
            ]}
          >
            {draft.status === "saving" || query.meta.isMutating
              ? "Saving…"
              : draft.dirty || metaDirty
                ? draft.status && !["dirty", "saving"].includes(draft.status)
                  ? draft.status
                  : "Unsaved changes"
                : "Saved"}
          </Text>
          {preview ? (
            <DocumentContent content={draft.content} />
          ) : (
            <DocumentEditor
              attachments={
                <DocumentAttachmentControls
                  attachments={attachments}
                  disabled={busy}
                />
              }
              ref={editor}
              room={note.room_id ?? undefined}
              content={draft.content}
              onChange={draft.handleChange}
              disabled={busy}
            />
          )}
        </PageScrollView>
        <PopupMenu
          mode="dialog"
          open={Boolean(note.can_manage && confirmDelete)}
          title="Delete this note?"
          dismissDisabled={busy}
          onClose={() => setConfirmDelete(false)}
          actions={[
            {
              id: "delete",
              label: "Confirm delete note",
              disabled: busy,
              onSelect: () => {
                void runOperation(async () => {
                  await save();
                  await query.remove.trigger();
                  draft.reset();
                  navigationGuard.release();
                  navigation.returnTo(`/app/rooms/${note.room_id}/notes`);
                });
              },
            },
            {
              id: "keep",
              label: "Keep note",
              disabled: busy,
              onSelect: () => setConfirmDelete(false),
            },
          ]}
        >
          <Text style={layout.text}>This cannot be undone.</Text>
          {error && (
            <Text accessibilityRole="alert" style={layout.text}>
              {error}
            </Text>
          )}
        </PopupMenu>
        <PopupMenu
          mode="page"
          open={Boolean(selectedBlocks)}
          title={`Move ${selectedBlocks?.blocks.length ?? 0} ${(selectedBlocks?.blocks.length ?? 0) === 1 ? "block" : "blocks"} to`}
          dismissDisabled={busy}
          onClose={() => setSelectedBlocks(null)}
          actions={[]}
        >
          {error && (
            <Text accessibilityRole="alert" style={layout.text}>
              {error}
            </Text>
          )}
          {transfer.tree.isLoading && (
            <ActivityIndicator accessibilityLabel="Loading destination Notes" />
          )}
          {transfer.tree.error ? (
            <Button
              onPress={() => {
                void transfer.tree.mutate().catch(() => {});
              }}
            >
              Retry destination Notes
            </Button>
          ) : (
            <NoteTree
              nodes={transfer.tree.data?.pages ?? []}
              destination
              selectable={(item) => item.id !== note.id}
              disabled={busy || transferAttempted}
              onOpen={(item) => {
                void move(item.id);
              }}
            />
          )}
        </PopupMenu>
        <PopupMenu
          mode="menu"
          open={actionsOpen}
          title="Note actions"
          anchor={actionAnchor}
          onClose={() => setActionsOpen(false)}
          actions={[
            {
              id: "copy",
              label:
                Platform.OS === "web" ? "Copy note link" : "Share note link",
              onSelect: () => {
                setActionsOpen(false);
                void shareAppLink(`/app/note/${note.id}`)
                  .then(setNotice)
                  .catch(() =>
                    setError("Could not share the Note link. Try again."),
                  );
              },
            },
            {
              id: "preview",
              label: preview ? "Edit note" : "Preview note",
              disabled: busy,
              onSelect: () => {
                setActionsOpen(false);
                if (preview) {
                  setPreview(false);
                  return;
                }
                void editor.current
                  ?.flush()
                  .then((content) => {
                    draft.handleChange(content);
                    setPreview(true);
                  })
                  .catch((reason) => setError(reason.message));
              },
            },
            {
              id: "save",
              label: "Save note",
              disabled: busy,
              onSelect: () => {
                setActionsOpen(false);
                void save().catch((reason) => setError(reason.message));
              },
            },
            {
              id: "move",
              label: "Move selected blocks to another Note",
              disabled: busy || attachments.pending || preview,
              onSelect: () => {
                setActionsOpen(false);
                void chooseMove();
              },
            },
            {
              id: "child",
              label: "Add child note",
              disabled: busy || attachments.pending,
              onSelect: () => {
                setActionsOpen(false);
                void runOperation(async () => {
                  await save();
                  const child = await query.child.trigger();
                  navigation.destination(`/app/note/${child.id}`);
                });
              },
            },
            ...(note.can_manage
              ? [
                  {
                    id: "delete",
                    label: "Delete note",
                    disabled: busy,
                    onSelect: () => {
                      setActionsOpen(false);
                      setConfirmDelete(true);
                    },
                  },
                ]
              : []),
          ]}
        />
      <Toast message={notice} onDismiss={() => setNotice(undefined)} />
      </ViewportShell>
    </DocumentNoteContext.Provider>
  );
}
const styles = StyleSheet.create({
  saved: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0,
  },
  content: { paddingVertical: 8, gap: 8 },
  metadata: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconField: { width: 40, height: 44 },
  iconPlaceholder: {
    position: "absolute",
    top: 2,
    left: 0,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: tokens.border,
    borderRadius: tokens.radius,
  },
  iconInput: {
    width: 40,
    padding: 0,
    borderWidth: 0,
    fontSize: 24,
    textAlign: "center",
    backgroundColor: "transparent",
  },
  titleInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: 0,
    fontFamily: "PoppinsSemibold",
    fontSize: 28.8,
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: "transparent",
  },
  target: { minHeight: 48, minWidth: 48 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
