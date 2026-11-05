import { UserIdentityName } from "../../components/UserIdentity";
import { Icon } from "../../components/Icon";
import { isContentControl } from "../../lib/contentInteraction";
import { Button } from "../../components/Button";
import {
  Platform,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { RoomEntryPreview } from "../../lib/api/room";
import { materialDocument, materialNodeText, materialNodeHasVisibleContent } from "../../lib/materialDocument";
import { DocumentContent } from "./DocumentContent";
import { DocumentMedia } from "./DocumentMedia";
import { tokens } from "../../styles/tokens";
import { layout } from "../../styles/layout";
import { type ReactNode, useState } from "react";
import { mediaMosaic } from "../../lib/mediaMosaic";

/** Content-only entry adapter; Chat keeps its own author group around it. */
type Entry = Pick<RoomEntryPreview, "content" | "format" | "format_data"> &
  Partial<RoomEntryPreview>;
export function EntryContent({
  entry,
  coverContributor,
  headingLevel = 2,
  preview = false,
  compactPreview = false,
  previewLines = 7,
  previewTitleLines,
  previewTitleStyle,
  previewMediaHeight,
  previewTextStyle,
  showCoverCredit = true,
  onMediaOpen,
  onMediaRemove,
  renderMediaOverlay,
  onOpen,
  interactive = true,
  compactSingleAudio = false,
}: {
  compactSingleAudio?: boolean;
  renderMediaOverlay?: (index: number, corners: ViewStyle) => ReactNode;
  onMediaRemove?: (index: number) => void;
  onOpen?: () => void;
  interactive?: boolean;
  onMediaOpen?: (index: number) => void;
  entry: Entry;
  coverContributor?: string;
  headingLevel?: number;
  preview?: boolean;
  compactPreview?: boolean;
  previewLines?: number;
  previewTitleLines?: number;
  previewTitleStyle?: TextStyle;
  previewMediaHeight?: number;
  previewTextStyle?: TextStyle;
  showCoverCredit?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const document = materialDocument(entry);
  const media =
    document.content?.filter((node) =>
      ["image", "audio", "video"].includes(node.type),
    ) || [];
  const text =
    document.content?.filter(
      (node) => !["image", "audio", "video"].includes(node.type) && materialNodeHasVisibleContent(node),
    ) || [];
  const rawTitle = entry.format === "mixed_media" ? entry.format_data?.title?.trim() : undefined;
  const title = rawTitle && materialNodeHasVisibleContent({ type: "text", text: rawTitle }) ? rawTitle : undefined;
  const duplicateTitle =
    title &&
    text[0]?.type === "heading" &&
    materialNodeText(text[0]).trim() === title.trim();
  const singleAudio =
    compactSingleAudio && media.length === 1 && media[0].type === "audio";
  const tiles = mediaMosaic(media.length);
  const unit = Math.max(0, (width - 12) / 4);
  const rows = Math.max(0, ...tiles.map((tile) => tile.y + tile.height));
  const mediaStep =
    preview && previewMediaHeight ? (previewMediaHeight + 4) / rows : unit + 4;
  const copy = (
    <>
      {title && !duplicateTitle && (
        <Text
          accessibilityRole="header"
          aria-level={Platform.OS === "web" ? headingLevel : undefined}
          style={[styles.title, preview && previewTitleStyle]}
          numberOfLines={preview ? previewTitleLines : undefined}
        >
          {title}
        </Text>
      )}
      {text.length > 0 && !(preview && previewLines === 0) && (
        <View>
          <DocumentContent
            interactive={interactive && !onOpen}
            previewLines={preview ? previewLines : undefined}
            previewTextStyle={previewTextStyle}
            compactHeadings
            headingLevel={headingLevel}
            content={{ type: "doc", content: text }}
          />
        </View>
      )}
    </>
  );
  return (
    <View
      style={[
        styles.content,
        compactPreview && preview && styles.compactContent,
      ]}
    >
      {entry.room_statement?.trim() && <View style={styles.statement}>
        <Text style={styles.statementText} numberOfLines={preview ? 4 : undefined}>{entry.room_statement}</Text>
      </View>}
      {media.length > 0 && (
        <View
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          style={[
            styles.media,
            compactPreview && preview && styles.insetMedia,
            {
              height: singleAudio ? 144 : rows * mediaStep - 4,
            },
          ]}
        >
          {width > 0 &&
            media.map((node, index) => {
              const tile = tiles[index];
              const outerRadius = compactPreview && preview ? 10 : 16;
              const corners = {
                borderTopLeftRadius: tile.x === 0 && tile.y === 0 ? outerRadius : 4,
                borderTopRightRadius: tile.x + tile.width === 4 && tile.y === 0 ? outerRadius : 4,
                borderBottomLeftRadius: tile.x === 0 && tile.y + tile.height === rows ? outerRadius : 4,
                borderBottomRightRadius: tile.x + tile.width === 4 && tile.y + tile.height === rows ? outerRadius : 4,
              };
              return (
                <View
                  key={index}
                  style={[
                    styles.tile,
                    corners,
                    {
                      left: tile.x * (unit + 4),
                      top: tile.y * mediaStep,
                      width: tile.width * (unit + 4) - 4,
                      height: singleAudio ? 144 : tile.height * mediaStep - 4,
                    },
                  ]}
                >
                  {onMediaOpen ? (
                    <Button
                      emphasis="bare"
                      accessibilityLabel={`Open ${node.type} ${index + 1}`}
                      style={styles.mediaLink}
                      onPress={(event) => {
                        if (!isContentControl(event)) onMediaOpen(index);
                      }}
                    >
                      <DocumentMedia
                        node={node}
                        tiled
                        previewOnly
                      />
                    </Button>
                  ) : (
                    <DocumentMedia
                      node={node}
                      tiled
                      previewOnly={!interactive}
                    />
                  )}
                  {renderMediaOverlay?.(index, corners)}
                  {onMediaRemove && (
                    <Button
                      shape="circle"
                      hitSlop={16}
                      color={
                        node.type === "audio"
                          ? tokens.paper
                          : tokens.surfaceMuted
                      }
                      accessibilityLabel={`Remove ${node.type} ${index + 1}`}
                      style={styles.removeMedia}
                      onPress={() => onMediaRemove(index)}
                    >
                      <Icon name="xBold" size={11.2} color={tokens.ink} />
                    </Button>
                  )}
                </View>
              );
            })}
        </View>
      )}
      {((title && !duplicateTitle) || (text.length > 0 && !(preview && previewLines === 0))) &&
        (onOpen ? (
          <Button
            emphasis="bare"
            style={[
              styles.copyLink,
              compactPreview && preview && styles.compactCopy,
            ]}
            onPress={(event) => {
              if (!isContentControl(event)) onOpen();
            }}
          >
            {copy}
          </Button>
        ) : (
          copy
        ))}
      {entry.shared_feedback?.map((feedback, index) => <View key={`${feedback.source_reply_id ?? "copy"}:${index}`} style={styles.savedFeedback}>
        <UserIdentityName username={feedback.author_name} compact />
        <EntryContent entry={{ content: feedback.content, format: feedback.format, format_data: feedback.format_data }}
          preview={preview} previewLines={preview ? 2 : undefined} interactive={interactive} onOpen={onOpen} />
      </View>)}
      {showCoverCredit && (
        <EntryCoverCredit entry={entry} coverContributor={coverContributor} />
      )}
    </View>
  );
}
export function EntryCoverCredit({
  entry,
  coverContributor,
  style,
}: {
  entry: Entry;
  coverContributor?: string;
  style?: StyleProp<TextStyle>;
}) {
  const attribution = entry.format_data?.round_attribution;
  const legacy = entry.format_data?.round_activity;
  const contributor =
    attribution?.cover_contributor_name ??
    legacy?.cover_contributor_name ??
    coverContributor;
  const visible =
    coverContributor !== undefined ||
    (attribution?.template_key ?? legacy?.activity_key) === "art_before_chorus";
  return visible ? (
    <Text style={[layout.muted, style]}>
      Cover art from {contributor ?? "Anonymous"}
    </Text>
  ) : null;
}
const styles = StyleSheet.create({
  statement: { borderWidth: 1, borderColor: tokens.border, borderRadius: 10, padding: 8, marginRight: 22 },
  statementText: { fontFamily: "Lato", fontStyle: "italic", fontSize: 14, lineHeight: 20, color: tokens.ink },
  savedFeedback: { backgroundColor: tokens.paper, borderRadius: 10, padding: 4, marginLeft: 22, gap: 4 },
  removeMedia: {
    position: "absolute",
    top: 8,
    right: 8,
    zIndex: 1,
    width: 16,
    height: 16,
    minWidth: 16,
    minHeight: 16,
  },
  copyLink: {
    padding: 4,
    paddingHorizontal: 4,
    paddingVertical: 4,
    alignItems: "stretch",
    gap: 8,
  },
  mediaLink: {
    width: "100%",
    height: "100%",
    padding: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    alignItems: "stretch",
  },
  content: { gap: 8 },
  compactContent: { gap: 4 },
  compactCopy: { gap: 4, padding: 0, paddingHorizontal: 0, paddingVertical: 0 },
  insetMedia: { borderRadius: 10 },
  media: { width: "100%", borderRadius: 16, overflow: "hidden" },
  tile: { position: "absolute", borderRadius: 4, overflow: "hidden" },
  title: {
    fontFamily: "LatoBold",
    fontSize: 17,
    lineHeight: 22.1,
    color: tokens.ink,
  },
});
