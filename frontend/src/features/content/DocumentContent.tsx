import { contentSourceLabel } from "../../lib/contentSourceLabel";
import { Fragment, memo, useState, type ReactNode } from "react";
import {
  Platform,
  useWindowDimensions,
  processColor,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from "react-native";
import type { TiptapDoc, TiptapNode } from "../../lib/tiptap";
import { contentLink } from "../../lib/contentLinks";
import { useContentLink } from "../../hooks/useContentLink";
import { tokens } from "../../styles/tokens";
import { layout } from "../../styles/layout";
import { DocumentMedia } from "./DocumentMedia";
import { NoteLink } from "./NoteLink";
import {
  useMessageGestureBoundary,
  useMessageTextSelectable,
} from "../../hooks/useMessageGestureBoundary";
import {
  formatAudioTimestamp,
  normalizeAudioSeconds,
} from "../../lib/audioTimestamp";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/Button";

const hasInlineAction = (node: TiptapNode): boolean =>
  node.type === "audioTimestamp" ||
  (node.type === "mention" && Boolean(contentLink(node.attrs?.href))) ||
  Boolean(
    node.marks?.some(
      (mark) => mark.type === "link" && contentLink(mark.attrs?.href),
    ),
  ) ||
  Boolean(node.content?.some(hasInlineAction));

/** The universal read-only document surface. Chat and entry previews share it. */
export const DocumentContent = memo(function DocumentContent({
  content,
  headingLevel = 2,
  compactHeadings = false,
  previewLines,
  previewTextStyle,
  interactive = true,
}: {
  interactive?: boolean;
  content: TiptapDoc;
  headingLevel?: number;
  compactHeadings?: boolean;
  previewLines?: number;
  previewTextStyle?: TextStyle;
}) {
  const links = useContentLink();
  const { width } = useWindowDimensions();
  const headingStyle = (level: number) => {
    if (compactHeadings) return styles.heading;
    const sizes =
      width >= 1200
        ? [40, 32, 28, 24, 20, 16]
        : [
            32 + width * 0.015,
            21.2 + width * 0.009,
            20.8 + width * 0.006,
            20.4 + width * 0.003,
            20,
            16,
          ];
    const size = sizes[Math.min(5, Math.max(0, level - 1))];
    return {
      fontFamily: "PoppinsSemibold",
      fontSize: size,
      lineHeight: size * 1.05,
    };
  };
  const protectTouch = useMessageGestureBoundary();
  const selectable = useMessageTextSelectable();
  const [timestamp, setTimestamp] = useState<TiptapNode>();
  const openTimestamp = (node: TiptapNode) => {
    const href = contentLink(node.attrs?.sourcePath);
    if (href) void links.open(href);
    else setTimestamp(node);
  };
  const inline = (
    node: TiptapNode,
    key: number,
    siblings: TiptapNode[],
  ): ReactNode => {
    if (node.type === "hardBreak") return "\n";
    if (node.type === "audioTimestamp") {
      const seconds = Math.max(0, Number(node.attrs?.seconds) || 0);
      return (
        <Fragment key={key}>
          <Text
            style={styles.timestampInline}
            accessibilityRole={interactive ? "link" : undefined}
            onPressIn={interactive ? protectTouch : undefined}
            onPress={interactive ? () => openTimestamp(node) : undefined}
          >
            {String(node.attrs?.title || "Audio")} @ {Math.floor(seconds / 60)}:
            {String(Math.floor(seconds % 60)).padStart(2, "0")}
          </Text>
          {siblings[key + 1] &&
          siblings[key + 1].type !== "hardBreak" &&
          !/^\s/.test(siblings[key + 1].text ?? "")
            ? " "
            : null}
        </Fragment>
      );
    }
    if (node.type === "mention") {
      const href = contentLink(node.attrs?.href);
      return (
        <Text
          key={key}
          style={styles.mention}
          accessibilityRole={interactive && href ? "link" : undefined}
          onPressIn={interactive && href ? protectTouch : undefined}
          onPress={
            interactive && href
              ? () => {
                  void links.open(href);
                }
              : undefined
          }
        >
          @{String(node.attrs?.label || node.attrs?.id || "mention")}
        </Text>
      );
    }
    const marks: TextStyle[] = [];
    let href: string | undefined;
    for (const mark of node.marks || []) {
      if (mark.type === "bold") marks.push(styles.bold);
      if (mark.type === "italic") marks.push(styles.italic);
      if (mark.type === "strike") marks.push(styles.strike);
      if (mark.type === "underline") marks.push(styles.underline);
      if (mark.type === "code") marks.push(styles.code);
      if (mark.type === "highlight") marks.push(styles.highlight);
      if (
        mark.type === "highlight" &&
        typeof mark.attrs?.color === "string" &&
        processColor(mark.attrs.color) != null
      )
        marks.push({ backgroundColor: mark.attrs.color });
      if (mark.type === "textStyle") {
        const attrs = mark.attrs || {};
        if (
          typeof attrs.color === "string" &&
          processColor(attrs.color) != null
        )
          marks.push({ color: attrs.color });
        if (
          typeof attrs.backgroundColor === "string" &&
          processColor(attrs.backgroundColor) != null
        )
          marks.push({ backgroundColor: attrs.backgroundColor });
        const size =
          typeof attrs.fontSize === "string" &&
          /^(\d+(?:\.\d+)?)(px|rem)$/.exec(attrs.fontSize);
        const pixels = size
          ? Number(size[1]) * (size[2] === "rem" ? 16 : 1)
          : NaN;
        if (Number.isFinite(pixels) && pixels > 0)
          marks.push({ fontSize: Math.min(512, pixels) });
      }
      if (mark.type === "link") href = contentLink(mark.attrs?.href);
    }
    return (
      <Text
        key={key}
        style={[...marks, href && styles.link]}
        accessibilityRole={interactive && href ? "link" : undefined}
        onPressIn={interactive && href ? protectTouch : undefined}
        onPress={
          interactive && href
            ? () => {
                void links.open(href);
              }
            : undefined
        }
      >
        {node.text ?? node.content?.map(inline)}
      </Text>
    );
  };
  const block = (node: TiptapNode, key: number, depth = 0): ReactNode => {
    if (depth > 30) return null;
    const children = () =>
      node.content?.map((child, index) => block(child, index, depth + 1));
    const stamp =
      node.type === "paragraph" &&
      node.content?.find((child) => child.type === "audioTimestamp");
    if (!interactive && stamp)
      return (
        <Text key={key} style={styles.timestampInline}>
          {node.content?.map(inline)}
        </Text>
      );
    if (
      stamp &&
      node.content?.every(
        (child) =>
          child.type === "audioTimestamp" ||
          (child.type === "text" && !child.text?.trim()),
      )
    ) {
      return (
        <View key={key} onTouchStart={protectTouch} style={styles.timestampRow}>
          {node.content
            .filter((child) => child.type === "audioTimestamp")
            .map((child, index) => (
              <Button
                key={index}
                emphasis="bare"
                accessibilityRole="link"
                accessibilityLabel={`${String(child.attrs?.title || "Audio")} at ${formatAudioTimestamp(normalizeAudioSeconds(child.attrs?.seconds))}`}
                style={styles.timestampTarget}
                onPress={() => openTimestamp(child)}
              >
                <View style={styles.timestampChip}>
                  <Icon name="waveform" size={14} />
                  <Text style={styles.timestampLabel}>
                    {String(child.attrs?.title || "Audio")}
                  </Text>
                  <Text style={styles.timestampTime}>
                    @{" "}
                    {formatAudioTimestamp(
                      normalizeAudioSeconds(child.attrs?.seconds),
                    )}
                  </Text>
                </View>
              </Button>
            ))}
        </View>
      );
    }
    switch (node.type) {
      case "paragraph":
      case "heading":
      case "codeBlock":
        // Native selectable text consumes taps before nested link/timestamp
        // handlers. Keep selection on prose and let interactive runs receive taps.
        return (
          <Text
            key={key}
            onLongPress={protectTouch}
            selectable={
              selectable && (Platform.OS === "web" || !hasInlineAction(node))
            }
            accessibilityRole={node.type === "heading" ? "header" : undefined}
            aria-level={
              Platform.OS === "web" && node.type === "heading"
                ? Math.min(
                    6,
                    Math.max(
                      1,
                      headingLevel + (Number(node.attrs?.level) || 1) - 1,
                    ),
                  )
                : undefined
            }
            style={[
              layout.text,
              styles.paragraph,
              node.type === "heading" &&
                headingStyle(Number(node.attrs?.level) || 1),
              node.type === "codeBlock" && styles.codeBlock,
              ["left", "center", "right", "justify"].includes(
                String(node.attrs?.textAlign),
              ) && {
                textAlign: node.attrs?.textAlign as TextStyle["textAlign"],
              },
            ]}
          >
            {node.content?.map(inline) || "\n"}
          </Text>
        );
      case "bulletList":
      case "orderedList":
        return (
          <View key={key} style={styles.list}>
            {node.content?.map((child, index) => (
              <View key={index} style={styles.listRow}>
                <Text style={layout.text}>
                  {node.type === "orderedList"
                    ? `${Number(node.attrs?.start || 1) + index}.`
                    : "•"}
                </Text>
                <View style={styles.listBody}>
                  {block(child, index, depth + 1)}
                </View>
              </View>
            ))}
          </View>
        );
      case "blockquote":
        return (
          <View key={key} style={styles.quote}>
            {children()}
          </View>
        );
      case "horizontalRule":
        return <View key={key} style={styles.rule} />;
      case "image":
      case "audio":
      case "video":
      case "file":
      case "audioTimestamp":
        return (
          <DocumentMedia key={key} node={node} previewOnly={!interactive} />
        );
      case "noteLink":
      case "pageLink":
        return (
          <NoteLink
            interactive={interactive}
            key={key}
            id={node.attrs?.noteId ?? node.attrs?.pageId}
          />
        );
      case "contentSource": {
        const attrs = node.attrs || {};
        const href = contentLink(attrs.sourcePath);
        const label = contentSourceLabel({
          label: typeof attrs.label === "string" ? attrs.label : undefined,
          authorName:
            typeof attrs.authorName === "string" ? attrs.authorName : undefined,
          sourceType:
            typeof attrs.sourceType === "string" ? attrs.sourceType : undefined,
        });
        return (
          <Text
            key={key}
            style={[layout.text, href && styles.link]}
            accessibilityRole={interactive && href ? "link" : undefined}
            onPressIn={interactive && href ? protectTouch : undefined}
            onPress={
              interactive && href
                ? () => {
                    void links.open(href);
                  }
                : undefined
            }
          >
            {label}
          </Text>
        );
      }
      default:
        return node.content ? (
          <View key={key}>{children()}</View>
        ) : (
          <Text key={key} style={layout.text}>
            {node.text || "This content is unavailable."}
          </Text>
        );
    }
  };
  // A preview is one measured text run so larger fonts and rich blocks end on
  // a complete line. Fixed pixel clipping can cut through a heading or glyph.
  const previewable = (node: TiptapNode, depth = 0): boolean =>
    depth < 30 &&
    [
      "doc",
      "paragraph",
      "heading",
      "blockquote",
      "bulletList",
      "orderedList",
      "listItem",
      "codeBlock",
      "text",
      "hardBreak",
      "mention",
      "audioTimestamp",
    ].includes(node.type) &&
    (node.content?.every((child) => previewable(child, depth + 1)) ?? true);
  const previewText = (node: TiptapNode, key: number, depth = 0): ReactNode => {
    if (depth > 30) return null;
    if (["paragraph", "heading", "codeBlock"].includes(node.type))
      return (
        <Text
          key={key}
          style={
            node.type === "heading"
              ? styles.heading
              : node.type === "codeBlock"
                ? styles.code
                : undefined
          }
        >
          {node.content?.map(inline)}
        </Text>
      );
    return (
      <Fragment key={key}>
        {node.content?.map((child, index) => (
          <Fragment key={index}>
            {index > 0 ? "\n" : ""}
            {node.type === "bulletList"
              ? "• "
              : node.type === "orderedList"
                ? `${Number(node.attrs?.start || 1) + index}. `
                : ""}
            {previewText(child, index, depth + 1)}
          </Fragment>
        ))}
      </Fragment>
    );
  };
  if (previewLines && previewable(content))
    return (
      <Text
        onLongPress={protectTouch}
        selectable={
          selectable && (Platform.OS === "web" || !hasInlineAction(content))
        }
        numberOfLines={previewLines}
        ellipsizeMode="tail"
        style={[layout.text, previewTextStyle]}
      >
        {previewText(content, 0)}
      </Text>
    );
  return (
    <View style={styles.document}>
      {content.content?.map((node, index) => block(node, index))}
      {timestamp && <DocumentMedia node={timestamp} />}
      {links.error && (
        <Text accessibilityRole="alert" style={layout.text}>
          {links.error}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  timestampRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  timestampTarget: {
    alignSelf: "flex-start",
    minHeight: 32,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  timestampChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 4,
    paddingRight: 7,
    paddingVertical: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(26,37,39,0.2)",
    backgroundColor: "rgba(232,241,251,0.35)",
  },
  timestampLabel: { color: tokens.ink, fontFamily: "Lato", fontSize: 14 },
  timestampTime: {
    color: tokens.inkMuted,
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "700",
  },
  timestampInline: {
    backgroundColor: "rgba(232,241,251,0.35)",
    fontFamily: "Lato",
    fontSize: 14,
    color: tokens.ink,
  },
  inlineAction: { alignSelf: "flex-start", paddingHorizontal: 0 },
  document: { gap: 6 },
  paragraph: { margin: 0 },
  heading: { fontFamily: "LatoBold", fontSize: 17, lineHeight: 22.1 },
  bold: { fontFamily: "LatoBold" },
  italic: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through" },
  underline: { textDecorationLine: "underline" },
  code: {
    fontFamily: "monospace",
    fontSize: 13.6,
    backgroundColor: tokens.surface,
    borderRadius: 6.4,
  },
  codeBlock: {
    fontFamily: "monospace",
    fontSize: 12.8,
    backgroundColor: tokens.ink,
    color: tokens.surface,
    borderRadius: 8,
    padding: 1.6,
  },
  highlight: { backgroundColor: tokens.bright },
  link: { color: tokens.ink, textDecorationLine: "underline" },
  mention: { fontFamily: "LatoBold", backgroundColor: tokens.surface },
  list: { gap: 4, paddingLeft: 12 },
  listRow: { flexDirection: "row", gap: 8 },
  listBody: { flex: 1 },
  quote: { borderLeftWidth: 3, borderLeftColor: tokens.muted, paddingLeft: 16 },
  rule: { height: 1, backgroundColor: tokens.muted, marginVertical: 8 },
});
