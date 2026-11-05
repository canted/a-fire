"use dom";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DOMProps } from "expo/dom";
import { sameDocumentValue } from "../../lib/contentDraft";
import { useFonts } from "expo-font";
import { fonts } from "../../styles/fonts";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type ReactNodeViewProps,
} from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Node, mergeAttributes, type ChainedCommands } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";
import { PluginKey } from "@tiptap/pm/state";
import { Button } from "../../components/Button";
import { tokens } from "../../styles/tokens";
import { MediaPlayControl } from "../../components/MediaPreviewControls";
import type { EditorVideoPresentation } from "../../hooks/useEditorVideo";
import {
  displayAudioTitle,
  formatAudioAttachmentDate,
  formatAudioTime,
} from "../../lib/audioPresentation";
import type { EditorAudioPresentation } from "../../hooks/useEditorAudio";
import { AppImagePresentation } from "../../components/AppImagePresentation";
import { Icon } from "../../components/Icon";
import {
  getSelectedTopLevelPageBlocks,
  selectedPageBlocksStillMatch,
  type SelectedPageBlocks,
} from "../../lib/moveNoteBlocks";
import { moveEditorBlock } from "../../lib/editorBlocks";
import { contentTextExtensions } from "../../lib/contentTextExtensions";
import { createContentImageSchema } from "../../lib/contentImageSchema";
import {
  createContentMentionRuntime,
  type ContentMentionSuggestionState,
} from "../../lib/contentMention";
import { createAudioTimestampSchema } from "../../lib/audioTimestampSchema";
import {
  audioNodeSchema,
  videoNodeSchema,
  fileNodeSchema,
  noteLinkNodeSchema,
  contentSourceNodeSchema,
} from "../../lib/contentNodeSchemas";
import { contentLink } from "../../lib/contentLinks";
import type { MentionTarget } from "../../lib/api/mentions";
import type { TiptapDoc, TiptapNode } from "../../lib/tiptap";
import { contentFileSize } from "../../lib/contentFile";
import { contentSourceLabel } from "../../lib/contentSourceLabel";
import "../../styles/tokens.css";
import styles from "./RichDocumentEditor.module.css";
import { editorTools, editorToolIcons, type EditorCommand } from "./editorCommands";

const EditingContext = createContext<{
  disabled: boolean;
  mentions: MentionTarget[];
  mediaActive: boolean;
  mediaEpoch: number;
  audioPlayback: Props["audioPlayback"];
}>({
  disabled: false,
  mentions: [],
  mediaActive: true,
  mediaEpoch: 0,
  audioPlayback: { playing: false, position: 0, duration: 0, loading: false },
});

type Props = {
  content: TiptapDoc;
  disabled?: boolean;
  autoFocus?: boolean;
  accessibilityLabel?: string;
  bubble?: boolean;
  activeTools?: string[];
  commandBusy?: boolean;
  onFormat?: (name: EditorCommand["name"]) => Promise<void>;
  mentions: MentionTarget[];
  flushRequest: number;
  command?: EditorCommand;
  onCommandDone: (id: number, error?: string) => Promise<void>;
  onActiveTools?: (tools: string[]) => Promise<void>;
  onReady: (ready: boolean) => Promise<void>;
  onMention: (query: string | null) => Promise<void>;
  onChange: (doc: TiptapDoc) => Promise<void>;
  onFlush: (
    id: number,
    doc: TiptapDoc,
    error?: string,
    selection?: SelectedPageBlocks | null,
    unchanged?: boolean,
  ) => Promise<void>;
  onPreview: (node: TiptapNode) => Promise<void>;
  audioPlayback: {
    id?: string;
    playing: boolean;
    position: number;
    duration: number;
    loading: boolean;
    error?: string;
  };
  onVideoInfo: (node: TiptapNode) => Promise<EditorVideoPresentation>;
  onAudioInfo: (node: TiptapNode) => Promise<EditorAudioPresentation>;
  onAudioToggle: (node: TiptapNode) => Promise<void>;
  mediaActive: boolean;
  mediaEpoch: number;
  onImage: (node: TiptapNode) => Promise<string>;
  dom?: DOMProps;
};

/** DOM is confined to the editing engine. Credentials, uploads and media remain native owners. */
export default function RichDocumentEditor(props: Props) {
  useFonts({
    PoppinsSemibold: fonts.PoppinsSemibold,
    Lato: fonts.Lato,
    LatoBold: fonts.LatoBold,
  });
  const latest = useRef(props);
  latest.current = props;
  const echoes = useRef(new Set<string>());
  const previousContent = useRef(props.content);
  const [error, setError] = useState<string>();
  const invalid = useRef(false);
  const edited = useRef(false);
  const suggestion = useRef<ContentMentionSuggestionState | undefined>(
    undefined,
  );
  const handledCommand = useRef(0);
  const updateSuggestion = (next?: ContentMentionSuggestionState) => {
    suggestion.current = next;
    void latest.current.onMention(next?.query ?? null);
  };
  const extensions = useMemo(() => {
    function Attachment({
      node,
      selected,
      deleteNode,
      editor,
    }: ReactNodeViewProps) {
      const context = useContext(EditingContext);
      const imageRef = useRef<HTMLDivElement>(null);
      const [imageVisible, setImageVisible] = useState(false);
      const [imageSource, setImageSource] = useState<string>();
      const [imageError, setImageError] = useState(false);
      const [imageAttempt, setImageAttempt] = useState(0);
      const [video, setVideo] = useState<EditorVideoPresentation>();
      const [videoError, setVideoError] = useState(false);
      const [videoAttempt, setVideoAttempt] = useState(0);
      const [audio, setAudio] = useState<EditorAudioPresentation>();
      const [audioError, setAudioError] = useState(false);
      const [audioAttempt, setAudioAttempt] = useState(0);
      useEffect(() => {
        setVideo(undefined);
        setVideoError(false);
        if (node.type.name !== "video" || !context.mediaActive) return;
        let active = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const load = () => {
          void latest.current
            .onVideoInfo(node.toJSON() as TiptapNode)
            .then((value) => {
              if (!active) return;
              setVideo(value);
              if (["pending", "processing", "uploading"].includes(value.status))
                timer = setTimeout(load, 3000);
            })
            .catch(() => {
              if (active) setVideoError(true);
            });
        };
        load();
        return () => {
          active = false;
          clearTimeout(timer);
        };
      }, [node, context.mediaActive, context.mediaEpoch, videoAttempt]);
      useEffect(() => {
        setAudio(undefined);
        setAudioError(false);
        if (node.type.name !== "audio" || !context.mediaActive) return;
        let active = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const load = () => {
          void latest.current
            .onAudioInfo(node.toJSON() as TiptapNode)
            .then((value) => {
              if (!active) return;
              setAudio(value);
              if (!value.ready) timer = setTimeout(load, 3000);
            })
            .catch(() => {
              if (active) setAudioError(true);
            });
        };
        load();
        return () => {
          active = false;
          clearTimeout(timer);
        };
      }, [node, context.mediaActive, context.mediaEpoch, audioAttempt]);
      useEffect(() => {
        const element = imageRef.current;
        if (!element || node.type.name !== "image") return;
        const observer = new IntersectionObserver(
          (entries) =>
            setImageVisible(entries.some((entry) => entry.isIntersecting)),
          { rootMargin: "100px" },
        );
        observer.observe(element);
        return () => observer.disconnect();
      }, [node.type.name]);
      useEffect(() => {
        setImageSource(undefined);
        setImageError(false);
        if (node.type.name !== "image" || !context.mediaActive || !imageVisible)
          return;
        let active = true;
        void latest.current
          .onImage(node.toJSON() as TiptapNode)
          .then((uri) => {
            if (active) setImageSource(uri);
          })
          .catch(() => {
            if (active) setImageError(true);
          });
        return () => {
          active = false;
        };
      }, [
        node,
        context.mediaActive,
        context.mediaEpoch,
        imageVisible,
        imageAttempt,
      ]);
      const noteTitle =
        node.type.name === "noteLink"
          ? context.mentions.find(
              (target) =>
                target.targetType === "note" &&
                target.targetId === String(node.attrs.noteId),
            )?.label
          : undefined;
      const label =
        node.type.name === "contentSource"
          ? contentSourceLabel(node.attrs)
          : String(
              noteTitle ||
                node.attrs.title ||
                node.attrs.filename ||
                node.attrs.alt ||
                (node.type.name === "noteLink"
                  ? "Linked note"
                  : node.type.name),
            );
      const reference = ["noteLink", "contentSource"].includes(node.type.name);
      const size =
        node.type.name === "file" ? contentFileSize(node.attrs.size) : null;
      if (node.type.name === "video")
        return (
          <NodeViewWrapper
            className={styles.videoAttachment}
            contentEditable={false}
          >
            <div
              className={styles.videoPoster}
              style={{
                aspectRatio:
                  video?.width && video.height
                    ? video.width / video.height
                    : 16 / 9,
              }}
            >
              {video?.poster && (
                <AppImagePresentation
                  source={{ uri: video.poster }}
                  alt=""
                  ratio={
                    video.width && video.height
                      ? video.width / video.height
                      : 16 / 9
                  }
                  onError={() =>
                    setVideo((value) =>
                      value ? { ...value, poster: undefined } : value,
                    )
                  }
                />
              )}
              <div className={styles.videoPlay}>
                <MediaPlayControl
                  background={tokens.mediaTileControl}
                  playing={false}
                  label={`Play ${video?.title || label}`}
                  disabled={video?.status !== "ready"}
                  onPress={() => {
                    editor.commands.blur();
                    void latest.current.onPreview(node.toJSON() as TiptapNode);
                  }}
                />
              </div>
              {video?.duration != null && (
                <span className={styles.videoDuration}>
                  {formatAudioTime(video.duration / 1000)}
                </span>
              )}
            </div>
            <div className={styles.videoDetails}>
              <strong>{video?.title || label}</strong>
              <span>
                {videoError
                  ? "Video unavailable"
                  : video?.status === "failed"
                    ? "Video could not be processed"
                    : video?.status === "ready"
                      ? "Video"
                      : "Processing video…"}
              </span>
              {videoError && (
                <Button
                  emphasis="bare"
                  onPress={() => setVideoAttempt((value) => value + 1)}
                >
                  Retry video
                </Button>
              )}
            </div>
            {!context.disabled && (
              <div className={styles.imageRemove}>
                <Button
                  emphasis="bare"
                  accessibilityLabel="Remove video"
                  hitSlop={8}
                  style={{ width: 28, height: 28, minHeight: 28, padding: 0 }}
                  onPress={deleteNode}
                >
                  <Icon name="x" size={18} />
                </Button>
              </div>
            )}
          </NodeViewWrapper>
        );
      if (node.type.name === "audio") {
        const current =
          context.audioPlayback.id === String(node.attrs.audioAssetId);
        const playing = current && context.audioPlayback.playing;
        const title = displayAudioTitle(audio?.title || label);
        const date = formatAudioAttachmentDate(audio?.createdAt);
        return (
          <NodeViewWrapper
            className={`${styles.audioAttachment} ${selected ? styles.selected : ""}`}
            contentEditable={false}
          >
            <div className={styles.audioDetails}>
              <strong>{title}</strong>
              {date && <span>{date}</span>}
              <span>
                Audio •{" "}
                {audio?.ready ? formatAudioTime(audio.duration) : "Processing"}
              </span>
            </div>
            <Button
              emphasis="outline"
              shape="pill"
              accessibilityLabel={`${playing ? "Pause" : "Play"} ${title}`}
              disabled={
                !audio?.ready || (current && context.audioPlayback.loading)
              }
              onPress={() => {
                editor.commands.blur();
                void latest.current
                  .onAudioToggle(node.toJSON() as TiptapNode)
                  .catch(() => setAudioError(true));
              }}
            >
              <span className={styles.audioPlay}>
                {!playing && <Icon name="play" size={13} />}
                {playing ? "Pause" : "Play"}
              </span>
            </Button>
            {(audioError || (current && context.audioPlayback.error)) && (
              <span role="alert">
                Audio unavailable.{" "}
                <Button
                  emphasis="bare"
                  accessibilityLabel="Retry audio"
                  onPress={() => setAudioAttempt((value) => value + 1)}
                >
                  Retry
                </Button>
              </span>
            )}
            {!context.disabled && (
              <div className={styles.imageRemove}>
                <Button
                  emphasis="bare"
                  accessibilityLabel="Remove audio"
                  hitSlop={8}
                  style={{
                    width: 28,
                    height: 28,
                    minHeight: 28,
                    paddingHorizontal: 0,
                    paddingVertical: 0,
                  }}
                  onPress={deleteNode}
                >
                  <Icon name="x" size={18} />
                </Button>
              </div>
            )}
          </NodeViewWrapper>
        );
      }
      if (node.type.name === "image")
        return (
          <NodeViewWrapper
            className={`${styles.imageAttachment} ${selected ? styles.selected : ""}`}
            contentEditable={false}
          >
            <div
              ref={imageRef}
              style={{
                maxWidth:
                  Number(node.attrs.width) > 0
                    ? Number(node.attrs.width)
                    : undefined,
              }}
            >
              <AppImagePresentation
                source={
                  imageSource
                    ? { uri: imageSource, cache: "reload" }
                    : undefined
                }
                alt={String(node.attrs.alt || "")}
                ratio={
                  Number(node.attrs.width) > 0 && Number(node.attrs.height) > 0
                    ? Number(node.attrs.width) / Number(node.attrs.height)
                    : 1
                }
                failed={imageError}
                onError={() => setImageError(true)}
                retry={() => setImageAttempt((value) => value + 1)}
              />
            </div>
            {!context.disabled && selected && (
              <div className={styles.imageRemove}>
                <Button
                  emphasis="bare"
                  accessibilityLabel="Remove image"
                  hitSlop={8}
                  style={{
                    width: 28,
                    height: 28,
                    minHeight: 28,
                    paddingHorizontal: 0,
                    paddingVertical: 0,
                  }}
                  onPress={deleteNode}
                >
                  <Icon name="x" size={18} />
                </Button>
              </div>
            )}
          </NodeViewWrapper>
        );
      return (
        <NodeViewWrapper
          className={`${styles.attachment} ${selected ? styles.selected : ""}`}
          contentEditable={false}
        >
          <Button
            emphasis="bare"
            accessibilityLabel={`${reference ? "Open" : "Preview"} ${label}`}
            onPress={() => {
              editor.commands.blur();
              void latest.current.onPreview(node.toJSON() as TiptapNode);
            }}
          >
            <Icon
              name={
                node.type.name === "contentSource"
                  ? "arrowBendDownRight"
                  : node.type.name === "audio"
                    ? "waveform"
                    : node.type.name === "image"
                      ? "imageSquare"
                      : node.type.name === "video"
                        ? "play"
                        : "fileText"
              }
              size={24}
            />
            <span className={styles.attachmentLabel}>
              {label}
              {size && <span className={styles.fileSize}>{size}</span>}
            </span>
          </Button>
          {!context.disabled && !reference && (
            <Button
              emphasis="bare"
              accessibilityLabel={`Remove ${label}`}
              onPress={deleteNode}
            >
              <Icon name="x" size={18} />
            </Button>
          )}
        </NodeViewWrapper>
      );
    }
    const view = () => ReactNodeViewRenderer(Attachment);
    const { createMentionNode } = createContentMentionRuntime({
      Mention,
      PluginKey,
      mergeAttributes,
    });
    return [
      ...contentTextExtensions({
        StarterKit,
        TextAlign,
        TextStyleKit,
        Highlight,
        Link,
      }),
      createContentImageSchema({ Image, mergeAttributes }, true).extend({
        addNodeView: view,
      }),
      ...[
        audioNodeSchema("editor"),
        videoNodeSchema("editor"),
        fileNodeSchema("editor"),
        noteLinkNodeSchema(),
        contentSourceNodeSchema(),
      ].map((schema) => Node.create({ ...schema, addNodeView: view })),
      createAudioTimestampSchema({ Node, mergeAttributes }),
      createMentionNode({
        renderMode: "editor",
        suggestion: {
          getTargets: () => latest.current.mentions,
          onStart: updateSuggestion,
          onUpdate: updateSuggestion,
          onExit: () => updateSuggestion(undefined),
          onKeyDown: ({ event }) => {
            if (event.key === "Escape") {
              updateSuggestion(undefined);
              return true;
            }
            return false;
          },
        },
      }).extend({
        addNodeView() {
          return ({ node }) => {
            const dom = document.createElement("span");
            dom.className = styles.mention;
            dom.textContent = String(
              node.attrs.label || node.attrs.id || "mention",
            );
            return { dom };
          };
        },
      }),
    ];
  }, []);
  const editor = useEditor({
    extensions,
    content: props.content,
    immediatelyRender: false,
    editable: !props.disabled,
    enableContentCheck: true,
    autofocus: props.autoFocus ? "end" : false,
    onContentError: () => {
      invalid.current = true;
      setError(
        "This document contains unsupported content. Editing is paused to preserve it.",
      );
    },
    editorProps: {
      attributes: {
        class: styles.prose,
        role: "textbox",
        "aria-label": props.accessibilityLabel || "Note and entry text",
        "aria-multiline": "true",
        "data-testid": "document-rich-text",
      },
    },
    onUpdate: ({ editor: current }) => {
      if (invalid.current) return;
      edited.current = true;
      const doc = current.getJSON() as TiptapDoc;
      echoes.current.add(JSON.stringify(doc));
      if (echoes.current.size > 100)
        echoes.current.delete(echoes.current.values().next().value!);
      void latest.current.onChange(doc);
    },
  });
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const active = [
        "link",
        "bold",
        "italic",
        "underline",
        "strike",
        "highlight",
        "code",
        "paragraph",
        "bulletList",
        "orderedList",
        "blockquote",
        "codeBlock",
      ].filter((name) => editor.isActive(name));
      for (const level of [1, 2, 3])
        if (editor.isActive("heading", { level }))
          active.push(`heading${level}`);
      for (const textAlign of ["left", "center", "right"])
        if (editor.isActive({ textAlign })) active.push(textAlign);
      void latest.current.onActiveTools?.(active);
    };
    editor.on("transaction", update);
    update();
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);
  useEffect(() => {
    editor?.setEditable(!props.disabled && !error, false);
  }, [editor, props.disabled, error]);
  useEffect(() => {
    if (!editor || error) return;
    // Attachment/title updates can rebuild the same body while a DOM edit is
    // arriving. Reapplying that old snapshot would overwrite the newer typing.
    if (sameDocumentValue(previousContent.current, props.content)) return;
    previousContent.current = props.content;
    const incoming = JSON.stringify(props.content);
    if (
      echoes.current.has(incoming) ||
      sameDocumentValue(props.content, editor.getJSON())
    )
      return;
    editor.commands.setContent(props.content, { emitUpdate: false });
    edited.current = false;
  }, [editor, props.content, error]);
  useEffect(() => {
    if (props.flushRequest && editor)
      void latest.current.onFlush(
        props.flushRequest,
        editor.getJSON() as TiptapDoc,
        error,
        getSelectedTopLevelPageBlocks(editor),
        !edited.current,
      );
  }, [props.flushRequest, editor, error]);
  useEffect(() => {
    void latest.current.onReady(Boolean(editor && !error));
  }, [editor, error]);
  useEffect(() => {
    const request = props.command;
    if (!editor || !request || request.id <= handledCommand.current) return;
    handledCommand.current = request.id;
    let commandError = invalid.current
      ? "Editing is paused to preserve unsupported content."
      : undefined;
    if (!invalid.current) {
      const chain = editor.chain().focus();
      const commands: Partial<
        Record<EditorCommand["name"], () => ChainedCommands>
      > = {
        bold: () => chain.toggleBold(),
        italic: () => chain.toggleItalic(),
        underline: () => chain.toggleUnderline(),
        strike: () => chain.toggleStrike(),
        highlight: () => chain.toggleHighlight(),
        code: () => chain.toggleCode(),
        heading1: () => chain.toggleHeading({ level: 1 }),
        heading2: () => chain.toggleHeading({ level: 2 }),
        heading3: () => chain.toggleHeading({ level: 3 }),
        paragraph: () => chain.setParagraph(),
        bulletList: () => chain.toggleBulletList(),
        orderedList: () => chain.toggleOrderedList(),
        blockquote: () => chain.toggleBlockquote(),
        codeBlock: () => chain.toggleCodeBlock(),
        divider: () => chain.setHorizontalRule(),
        left: () => chain.setTextAlign("left"),
        center: () => chain.setTextAlign("center"),
        right: () => chain.setTextAlign("right"),
        clearMarks: () => chain.unsetAllMarks(),
        undo: () => chain.undo(),
        redo: () => chain.redo(),
        unlink: () => chain.unsetLink(),
      };
      if (request.name === "removeBlocks") {
        try {
          const selected = JSON.parse(
            request.value ?? "null",
          ) as SelectedPageBlocks;
          if (!selected || !selectedPageBlocksStillMatch(editor, selected))
            commandError =
              "The selection changed. The copied blocks remain in both Notes.";
          else
            editor
              .chain()
              .deleteRange({ from: selected.from, to: selected.to })
              .run();
        } catch {
          commandError =
            "The selection could not be removed. The copied blocks remain in both Notes.";
        }
      } else if (request.name === "moveUp" || request.name === "moveDown")
        moveEditorBlock(editor, request.name === "moveUp" ? "up" : "down");
      else if (request.name === "link" && contentLink(request.value))
        chain
          .extendMarkRange("link")
          .setLink({ href: contentLink(request.value)! })
          .run();
      else if (request.name === "mention") {
        const target = latest.current.mentions.find(
          (item) => item.id === request.value,
        );
        if (target) suggestion.current?.command(target);
        updateSuggestion(undefined);
      } else commands[request.name]?.().run();
    }
    void latest.current.onCommandDone(request.id, commandError);
  }, [props.command, editor]);
  return (
    <div className={styles.root}>
      {error && <p role="alert">{error}</p>}
      <EditingContext.Provider
        value={{
          disabled: Boolean(props.disabled || error),
          mentions: props.mentions,
          mediaActive: props.mediaActive,
          mediaEpoch: props.mediaEpoch,
          audioPlayback: props.audioPlayback,
        }}
      >
        <EditorContent editor={editor} />
        {props.bubble && editor && !props.disabled && !error && (
          <BubbleMenu appendTo={() => document.body} className={styles.bubbleLayer} editor={editor} options={{ placement: "top", offset: 8 }}>
            <div className={styles.bubble} role="toolbar" aria-label="Text formatting" onMouseDown={(event) => event.preventDefault()}>
              {editorTools.filter(([name]) => ["bold", "italic", "underline", "strike", "highlight", "code"].includes(name)).map(([name, label]) => (
                <Button key={name} accessibilityLabel={label} selected={props.activeTools?.includes(name)} emphasis={props.activeTools?.includes(name) ? "outline" : "bare"} disabled={props.commandBusy} onPress={() => { void props.onFormat?.(name).catch(() => {}); }}>
                  <Icon name={editorToolIcons[name as keyof typeof editorToolIcons]} size={18} />
                </Button>
              ))}
              <Button accessibilityLabel="Link" emphasis="bare" disabled={props.commandBusy} onPress={() => { void props.onFormat?.("link").catch(() => {}); }}><Icon name="link" size={18} /></Button>
            </div>
          </BubbleMenu>
        )}
      </EditingContext.Provider>
    </div>
  );
}
