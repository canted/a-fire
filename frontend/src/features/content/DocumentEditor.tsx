import { useEditorVideo } from "../../hooks/useEditorVideo";
import { DocumentMedia } from "./DocumentMedia";
import { useEditorAudio } from "../../hooks/useEditorAudio";
import { useAudioPlayback } from "../../hooks/useAudioPlayback";
import { useEditorImage } from "../../hooks/useEditorImage";
import { matchingDocumentNode } from "../../lib/documentNodeIdentity";
import { useContentLink } from "../../hooks/useContentLink";
import { ViewportToolbar } from "../../components/ViewportToolbar";
import { PopupMenu } from "../../components/PopupMenu";
import { Icon } from "../../components/Icon";
import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Input } from "../../components/Input";
import {
  editorTools,
  editorToolIcons,
  type EditorCommand,
} from "./editorCommands";
import { filterMentionTargets } from "../../lib/mentionTargets";
import { contentLink } from "../../lib/contentLinks";
import { Button } from "../../components/Button";
import { DocumentContent } from "./DocumentContent";
import { useMentionTargets } from "../../hooks/useMentionTargets";
import type { SelectedPageBlocks } from "../../lib/moveNoteBlocks";
import type { TiptapDoc, TiptapNode } from "../../lib/tiptap";
import { layout } from "../../styles/layout";

const RichDocumentEditor = lazy(() => import("./RichDocumentEditor"));

type Snapshot = {
  content: TiptapDoc;
  selection: SelectedPageBlocks | null;
  unchanged?: boolean;
};
export type DocumentEditorHandle = {
  flush: () => Promise<TiptapDoc>;
  inspect: () => Promise<Snapshot>;
  removeBlocks: (selection: SelectedPageBlocks) => Promise<TiptapDoc>;
};
type Props = {
  ref?: Ref<DocumentEditorHandle>;
  content: TiptapDoc;
  onChange: (doc: TiptapDoc) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  toolbarMode?: "docked" | "bubble";
  accessibilityLabel?: string;
  room?: string | number;
  attachments?: React.ReactNode;
};
/** Only the editing engine runs in DOM. Media preview uses the same authorized native renderer as Chat. */
export function DocumentEditor({
  ref,
  content,
  onChange,
  disabled,
  autoFocus,
  toolbarMode = "docked",
  accessibilityLabel,
  room,
  attachments,
}: Props) {
  const mentions = useMentionTargets(room);
  const links = useContentLink();
  const images = useEditorImage();
  const audio = useEditorAudio();
  const video = useEditorVideo();
  const playback = useAudioPlayback();
  const currentContent = useRef(content);
  currentContent.current = content;
  const [preview, setPreview] = useState<TiptapNode>();
  const [flushRequest, setFlushRequest] = useState(0);
  const [command, setCommand] = useState<EditorCommand>();
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [commandBusy, setCommandBusy] = useState(false);
  const [error, setError] = useState<string>();
  const toolsAnchor = useRef<View>(null);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const commandFlight = useRef<{
    id: number;
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const sendCommand = (name: EditorCommand["name"], value?: string) => {
    if (
      (disabled && name !== "removeBlocks") ||
      !ready ||
      commandFlight.current
    )
      return Promise.reject(
        new Error("Wait for the editor to finish before trying again."),
      );
    const id = ++sequence.current;
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const timer = setTimeout(() => {
      commandFlight.current = null;
      setCommandBusy(false);
      reject(new Error("The editor did not apply the change. Try again."));
    }, 10_000);
    commandFlight.current = { id, promise, resolve, reject, timer };
    void promise.catch((reason) => setError(reason.message));
    setCommandBusy(true);
    setError(undefined);
    setCommand({ id, name, value });
    return promise;
  };
  const sequence = useRef(0);
  const pending = useRef(
    new Map<
      number,
      {
        resolve: (snapshot: Snapshot) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const inspect = async () => {
    await commandFlight.current?.promise;
    return new Promise<Snapshot>((resolve, reject) => {
      const id = ++sequence.current;
      const timer = setTimeout(() => {
        pending.current.delete(id);
        reject(
          new Error(
            "The editor did not respond. Keep this screen open and try saving again.",
          ),
        );
      }, 10_000);
      pending.current.set(id, { resolve, reject, timer });
      setFlushRequest(id);
    });
  };
  useImperativeHandle(ref, () => ({
    inspect,
    flush: async () => {
      const snapshot = await inspect();
      return snapshot.unchanged ? currentContent.current : snapshot.content;
    },
    removeBlocks: async (selection) => {
      await sendCommand("removeBlocks", JSON.stringify(selection));
      return (await inspect()).content;
    },
  }));
  useEffect(() => {
    const requests = pending.current;
    return () => {
      const flight = commandFlight.current;
      if (flight) {
        clearTimeout(flight.timer);
        flight.reject(
          new Error("The editor closed before applying the change."),
        );
        commandFlight.current = null;
      }
      for (const request of requests.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("The editor closed before saving."));
      }
      requests.clear();
    };
  }, []);
  const Toolbar = toolbarMode === "docked" ? ViewportToolbar : Fragment;
  return (
    <View style={styles.content}>
      <Suspense
        fallback={<ActivityIndicator accessibilityLabel="Loading editor" />}
      >
        <RichDocumentEditor
          autoFocus={autoFocus}
          accessibilityLabel={accessibilityLabel}
          bubble={toolbarMode === "bubble"}
          activeTools={activeTools}
          commandBusy={commandBusy}
          onFormat={async (name) => {
            if (name === "link") setLinkOpen((value) => !value);
            else await sendCommand(name);
          }}
          content={content}
          disabled={disabled}
          mentions={mentions.data?.targets ?? []}
          flushRequest={flushRequest}
          command={command}
          audioPlayback={{
            id: playback.targetId,
            playing: playback.playing,
            position: playback.position,
            duration: playback.duration,
            loading: playback.loading,
            error: playback.error,
          }}
          onVideoInfo={async (requested) => {
            const node = matchingDocumentNode(
              currentContent.current.content,
              requested,
            );
            if (!node || node.type !== "video")
              throw new Error("This video changed.");
            const info = await video.trigger(String(node.attrs?.videoAssetId));
            const poster = info.poster
              ? await images
                  .load({
                    type: "image",
                    attrs: {
                      src: info.poster,
                      width: info.width,
                      height: info.height,
                    },
                  })
                  .catch(() => undefined)
              : undefined;
            return { ...info, poster };
          }}
          onAudioInfo={async (requested) => {
            const node = matchingDocumentNode(
              currentContent.current.content,
              requested,
            );
            if (!node || node.type !== "audio")
              throw new Error("This audio changed.");
            return audio.trigger(String(node.attrs?.audioAssetId));
          }}
          onAudioToggle={async (requested) => {
            const node = matchingDocumentNode(
              currentContent.current.content,
              requested,
            );
            if (!node || node.type !== "audio")
              throw new Error("This audio changed.");
            const id = String(node.attrs?.audioAssetId);
            if (playback.targetId === id && playback.playing) playback.pause();
            else
              await playback.play(id, {
                audioNodeId:
                  typeof node.attrs?.nodeId === "string"
                    ? node.attrs.nodeId
                    : undefined,
              });
          }}
          mediaActive={images.active}
          mediaEpoch={images.epoch}
          onImage={async (requested) => {
            const node = matchingDocumentNode(
              currentContent.current.content,
              requested,
            );
            if (!node || node.type !== "image")
              throw new Error("This image changed. Select it again.");
            return images.load(node);
          }}
          onActiveTools={async (value) => setActiveTools((previous) =>
            previous.length === value.length && previous.every((name, index) => name === value[index]) ? previous : value
          )}
          onReady={async (value) => setReady(value)}
          onMention={async (query) => setMentionQuery(query)}
          onCommandDone={async (id, error) => {
            const flight = commandFlight.current;
            if (flight?.id === id) {
              clearTimeout(flight.timer);
              commandFlight.current = null;
              setCommandBusy(false);
              if (error) flight.reject(new Error(error));
              else flight.resolve();
            }
          }}
          onChange={async (next) => {
            currentContent.current = next;
            onChange(next);
          }}
          onPreview={async (requested) => {
            const node = matchingDocumentNode(
              currentContent.current.content,
              requested,
            );
            if (!node) {
              setError("This content changed. Select it again.");
              return;
            }
            if (node.type === "noteLink") {
              const id = node.attrs?.noteId ?? node.attrs?.pageId;
              if (/^[1-9]\d*$/.test(String(id)))
                await links.open(`/app/note/${id}`);
            } else if (node.type === "contentSource")
              await links.open(node.attrs?.sourcePath);
            else setPreview(node);
          }}
          onFlush={async (id, doc, error, selection, unchanged) => {
            // One response acknowledges all pending flushes up to this bridge request.
            for (const [key, request] of pending.current)
              if (key <= id) {
                clearTimeout(request.timer);
                pending.current.delete(key);
                if (error) request.reject(new Error(error));
                else
                  request.resolve({
                    content: doc,
                    selection: selection ?? null,
                    unchanged,
                  });
              }
          }}
          dom={{
            matchContents: true,
            scrollEnabled: false,
            nestedScrollEnabled: false,
          }}
        />
      </Suspense>
      {mentionQuery !== null && (
        <View style={layout.section}>
          {filterMentionTargets(mentions.data?.targets ?? [], mentionQuery)
            .slice(0, 8)
            .map((target) => (
              <Button
                key={target.id}
                emphasis="ghost"
                disabled={disabled || commandBusy || !ready}
                onPress={() => {
                  void sendCommand("mention", target.id).catch(() => {});
                }}
              >
                {target.label}
              </Button>
            ))}
        </View>
      )}
      <Toolbar>
        {attachmentsOpen && attachments}
        {linkOpen && (
          <View style={layout.section}>
            <Input
              accessibilityLabel="Selected text link"
              value={link}
              onChangeText={setLink}
              placeholder="https://…"
            />
            <Button
              disabled={!contentLink(link) || disabled || commandBusy || !ready}
              onPress={() => {
                void sendCommand("link", link).catch(() => {});
                setLinkOpen(false);
              }}
            >
              Apply link
            </Button>
            <Button
              emphasis="bare"
              disabled={disabled || commandBusy || !ready}
              onPress={() => {
                void sendCommand("unlink").catch(() => {});
                setLinkOpen(false);
              }}
            >
              Remove link
            </Button>
          </View>
        )}
        {toolbarMode === "docked" && <>
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.tools}
          accessibilityLabel="Text formatting"
        >
          <Button
            ref={toolsAnchor}
            hasPopup
            emphasis="bare"
            style={styles.target}
            disabled={disabled || !ready}
            expanded={toolsOpen}
            accessibilityLabel={toolsOpen ? "Fewer tools" : "More tools"}
            onPress={() => setToolsOpen((value) => !value)}
          >
            <Icon name="plusBold" size={18} />
          </Button>
          {(["moveDown", "moveUp"] as const).map((name) => (
            <Button
              key={name}
              emphasis="bare"
              style={styles.target}
              accessibilityLabel={name === "moveDown" ? "Move down" : "Move up"}
              disabled={disabled || commandBusy || !ready}
              onPress={() => {
                void sendCommand(name).catch(() => {});
              }}
            >
              <Icon name={editorToolIcons[name]} size={18} />
            </Button>
          ))}
          {attachments && (
            <Button
              emphasis="bare"
              style={styles.target}
              accessibilityLabel="Attach"
              expanded={attachmentsOpen}
              disabled={disabled || !ready}
              onPress={() => setAttachmentsOpen((value) => !value)}
            >
              <Icon name="paperclip" size={18} />
            </Button>
          )}
          <Button
            emphasis={activeTools.includes("link") ? "outline" : "bare"}
            style={styles.target}
            disabled={disabled || !ready}
            accessibilityLabel="Link"
            selected={activeTools.includes("link")}
            expanded={linkOpen}
            onPress={() => setLinkOpen((value) => !value)}
          >
            <Icon name="link" size={18} />
          </Button>
          {editorTools
            .filter(([name]) =>
              [
                "bold",
                "italic",
                "strike",
                "highlight",
                "code",
                "left",
                "center",
                "right",
              ].includes(name),
            )
            .map(([name, label]) => (
              <Button
                key={name}
                accessibilityLabel={label}
                selected={activeTools.includes(name)}
                emphasis={activeTools.includes(name) ? "outline" : "bare"}
                style={styles.target}
                disabled={disabled || commandBusy || !ready}
                onPress={() => {
                  void sendCommand(name).catch(() => {});
                }}
              >
                <Icon
                  name={editorToolIcons[name as keyof typeof editorToolIcons]}
                  size={18}
                />
              </Button>
            ))}
        </ScrollView>
        <PopupMenu
          mode="menu"
          open={toolsOpen}
          title="Insert block"
          anchor={toolsAnchor}
          onClose={() => setToolsOpen(false)}
          actions={editorTools
            .filter(
              ([name]) =>
                ![
                  "bold",
                  "italic",
                  "strike",
                  "highlight",
                  "code",
                  "left",
                  "center",
                  "right",
                  "moveUp",
                  "moveDown",
                ].includes(name),
            )
            .map(([name, label]) => ({
              id: name,
              label,
              selected: activeTools.includes(name),
              disabled: disabled || commandBusy || !ready,
              onSelect: () => {
                setToolsOpen(false);
                void sendCommand(name).catch(() => {});
              },
            }))}
        />
        </>}
      </Toolbar>
      {(error || links.error) && (
        <Text accessibilityRole="alert" style={layout.text}>
          {error || links.error}
        </Text>
      )}
      {mentions.error && (
        <Text style={layout.muted}>
          Mentions are temporarily unavailable. Existing mentions are preserved.
        </Text>
      )}
      {preview && (
        <PopupMenu
          mode="dialog"
          open
          title="Content preview"
          width={760}
          actions={[]}
          onClose={() => setPreview(undefined)}
        >
          {preview.type === "video" ? (
            <DocumentMedia node={preview} autoPlay />
          ) : (
            <DocumentContent content={{ type: "doc", content: [preview] }} />
          )}
        </PopupMenu>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16 },
  tools: { flexDirection: "row", alignItems: "center", gap: 2 },
  target: { minHeight: 48, minWidth: 48, paddingHorizontal: 8 },
});
