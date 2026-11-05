import { audioStyles } from "./AudioMedia.styles";
import { formatAudioTime } from "../../lib/audioPresentation";
import { AudioWaveform } from "./AudioWaveform";
import { useRecordingPreview } from "../../hooks/useRecordingPreview";
import { lazy, Suspense, useContext } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { TiptapNode } from "../../lib/tiptap";
import { useMediaAsset, useMediaSource } from "../../hooks/useMediaSource";
import { useFileDownload } from "../../hooks/useFileDownload";
import { Button } from "../../components/Button";
import { MediaPlayControl } from "../../components/MediaPreviewControls";
import { layout } from "../../styles/layout";
import { AppImage } from "../../components/AppImage";
import { Icon } from "../../components/Icon";
import { contentFileSize } from "../../lib/contentFile";
import { DocumentNoteContext } from "./DocumentContext";
import { appRoutes } from "../../lib/appRoutes";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { useMessageGestureBoundary } from "../../hooks/useMessageGestureBoundary";
import { tokens } from "../../styles/tokens";

const AudioMedia = lazy(() =>
  import("./MediaPlayers").then((module) => ({ default: module.AudioMedia })),
);
const VideoMedia = lazy(() =>
  import("./MediaPlayers").then((module) => ({ default: module.VideoMedia })),
);
export function DocumentMedia({
  node,
  tiled = false,
  autoPlay = false,
  expanded = false,
  previewOnly = false,
}: {
  previewOnly?: boolean;
  expanded?: boolean;
  node: TiptapNode;
  tiled?: boolean;
  autoPlay?: boolean;
}) {
  const protectTouch = useMessageGestureBoundary();
  const attrs = node.attrs || {};
  if (node.type === "image")
    return (
      <AppImage
        interactive={!previewOnly}
        tiled={tiled}
        src={typeof attrs.src === "string" ? attrs.src : ""}
        alt={String(attrs.alt || "Attached image")}
        width={Number(attrs.width)}
        height={Number(attrs.height)}
      />
    );
  if (node.type === "file" && previewOnly)
    return <Text style={layout.text}>{String(attrs.filename || "File")}</Text>;
  if (node.type === "file")
    return (
      <View onTouchStart={protectTouch}>
        <DocumentFile attrs={attrs} />
      </View>
    );
  return (
    <View
      style={tiled ? { height: "100%" } : undefined}
      onTouchStart={protectTouch}
    >
      <AssetMedia
        previewOnly={previewOnly}
        expanded={expanded}
        autoPlay={autoPlay}
        tiled={tiled}
        kind={node.type === "video" ? "video" : "audio"}
        id={attrs.audioAssetId ?? attrs.videoAssetId}
        audioNode={
          node.type === "audioTimestamp"
            ? typeof attrs.audioNodeId === "string"
              ? attrs.audioNodeId
              : undefined
            : typeof attrs.nodeId === "string"
              ? attrs.nodeId
              : undefined
        }
        seconds={
          node.type === "audioTimestamp"
            ? Number(attrs.seconds) || 0
            : undefined
        }
      />
    </View>
  );
}
function DocumentFile({ attrs }: { attrs: Record<string, unknown> }) {
  const name = String(attrs.filename || "File");
  const download = useFileDownload(attrs.src, name);
  const size = contentFileSize(attrs.size);
  return (
    <View>
      <Button
        emphasis="ghost"
        accessibilityLabel={
          download.isMutating ? "Opening file…" : `Download ${name}`
        }
        style={styles.file}
        disabled={download.isMutating}
        onPress={() => {
          void download.trigger().catch(() => {});
        }}
      >
        <View style={styles.fileRow}>
          <Icon name="fileText" size={24} />
          <View style={layout.grow}>
            <Text style={[layout.text, styles.filename]}>{name}</Text>
            {size && <Text style={styles.fileSize}>{size}</Text>}
          </View>
        </View>
      </Button>
      {download.error && (
        <Text accessibilityRole="alert" style={layout.text}>
          {download.error.message}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  file: {
    paddingHorizontal: 0,
    paddingVertical: 4,
    minHeight: 52,
    alignItems: "stretch",
  },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  filename: { fontFamily: "LatoBold" },
  fileSize: { fontFamily: "Lato", color: tokens.inkMuted, fontSize: 12 },
});
function AssetMedia({
  kind,
  id,
  seconds,
  tiled,
  audioNode,
  autoPlay,
  expanded,
  previewOnly,
}: {
  previewOnly?: boolean;
  expanded?: boolean;
  autoPlay?: boolean;
  audioNode?: string;
  tiled?: boolean;
  kind: "audio" | "video";
  id: unknown;
  seconds?: number;
}) {
  const note = useContext(DocumentNoteContext);
  const navigation = useRoomNavigation();
  const query = useMediaAsset(kind, id);
  const recordingPreview = useRecordingPreview(kind === "audio" ? Number(id) || undefined : undefined);
  const placeholder = recordingPreview ? (
    <View accessibilityLabel="Recorded audio" style={[audioStyles.audio, tiled && audioStyles.tileAudio]}>
      <View style={tiled && audioStyles.waveform}>
        <AudioWaveform recordingPreview peaks={recordingPreview.peaks} height={tiled ? "100%" : 60} />
      </View>
      <View style={tiled && audioStyles.audioControls}>
        <Text style={[layout.muted, tiled && audioStyles.controlTime, tiled && audioStyles.pendingDuration]}>{formatAudioTime(recordingPreview.duration)}</Text>
      </View>
    </View>
  ) : kind === "audio" && tiled ? (
    <View accessibilityLabel="Loading audio" style={[audioStyles.audio, audioStyles.tileAudio]}>
      <View style={[audioStyles.waveform, audioStyles.loadingWaveform]}>
        <Text numberOfLines={1} style={audioStyles.loadingMessage}>Loading</Text>
      </View>
      <View style={audioStyles.audioControls}>
        <MediaPlayControl
          size="small"
          background={tokens.mediaTileControl}
          foreground={tokens.paper}
          playing={false}
          disabled
          label="Audio loading"
          onPress={() => {}}
        />
        <Text style={audioStyles.controlTime}>
          {formatAudioTime((query.data?.duration_ms ?? 0) / 1000)}
        </Text>
      </View>
    </View>
  ) : <Text style={layout.text}>Loading {kind}…</Text>;
  const source = useMediaSource(
    query.data?.processing_status === "ready"
      ? query.data.playback_url
      : undefined,
  );
  if (!/^\d+$/.test(String(id)))
    return <Text style={layout.text}>This {kind} is unavailable.</Text>;
  if (query.error || source.error)
    return (
      <View>
        <Text style={layout.text}>This {kind} is unavailable.</Text>
        {!previewOnly && (
          <Button
            emphasis="link"
            onPress={() => {
              void query.mutate();
              void source.mutate();
            }}
          >
            Try again
          </Button>
        )}
      </View>
    );
  if (!query.data) return placeholder;
  if (recordingPreview && ["pending", "processing", "uploading"].includes(query.data.processing_status)) return placeholder;
  if (kind === "audio" && tiled && ["pending", "processing", "uploading"].includes(query.data.processing_status)) return placeholder;
  if (query.data.processing_status !== "ready")
    return (
      <Text style={layout.text}>
        {query.data.processing_status === "failed"
          ? `This ${kind} could not be processed.`
          : `Processing ${kind}…`}
      </Text>
    );
  if (!query.data.playback_url)
    return <Text style={layout.text}>This {kind} is unavailable.</Text>;
  if (!source.data) return placeholder;
  return (
    <Suspense fallback={placeholder}>
      {kind === "audio" ? (
        <AudioMedia
          previewOnly={previewOnly}
          expanded={expanded}
          audioNodeId={audioNode}
          tiled={tiled}
          key={query.data.id}
          source={source.data}
          asset={query.data}
          seconds={seconds}
          onReply={
            note
              ? (time) =>
                  navigation.destination(
                    appRoutes.noteAudioReply(note, {
                      audioAssetId: String(id),
                      audioNodeId: audioNode,
                      seconds: time,
                    }),
                  )
              : undefined
          }
        />
      ) : (
        <VideoMedia
          previewOnly={previewOnly}
          autoPlay={autoPlay}
          tiled={tiled}
          key={query.data.id}
          source={source.data}
          asset={query.data}
        />
      )}
    </Suspense>
  );
}
