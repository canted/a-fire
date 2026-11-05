import { audioStyles } from "./AudioMedia.styles";
import { useRecordingPreview } from "../../hooks/useRecordingPreview";
import { AUDIO_SPECTRUM_VERSION } from "../../../../types/audio-spectrum";
import { useAudioSeekControl } from "../../hooks/useAudioSeekControl";
import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useEvent } from "expo";
import { useAudioPlayback } from "../../hooks/useAudioPlayback";
import { useVideoPlayer, VideoView } from "expo-video";
import type { MediaAsset } from "../../hooks/useMediaSource";
import { useMediaPlayback } from "../../hooks/useMediaPlayback";
import { useAudioSpectrum } from "../../hooks/useAudioSpectrum";
import { MediaPlayControl } from "../../components/MediaPreviewControls";
import { AudioWaveform } from "./AudioWaveform";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
const time = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, "0")}`;
type Source = { uri: string; headers?: Record<string, string> };
export function AudioMedia({
  asset,
  seconds,
  audioNodeId,
  tiled = false,
  expanded = false,
  previewOnly = false,
  onReply,
}: {
  previewOnly?: boolean;
  expanded?: boolean;
  audioNodeId?: string;
  onReply?: (seconds: number) => void;
  source: Source;
  asset: MediaAsset;
  seconds?: number;
  tiled?: boolean;
}) {
  const spectrum = useAudioSpectrum(asset.id, asset.spectrum);
  const completeSpectrum = spectrum.data?.version === AUDIO_SPECTRUM_VERSION && spectrum.data.status === "ready" && Boolean(spectrum.data.peaks?.length);
  const recordingPreview = useRecordingPreview(asset.id, completeSpectrum);
  const playback = useAudioPlayback();
  const current = playback.targetId === String(asset.id);
  const playing = current && playback.playing;
  const position = current ? playback.position : 0;
  const duration = current
    ? playback.duration
    : (asset.duration_ms ?? 0) / 1000;
  const error = current && playback.error;
  const seek = (seconds: number) => {
    if (current) playback.seek(seconds);
    else
      void playback.play(String(asset.id), {
        startAt: Math.max(0, Math.min(duration, seconds)),
        audioNodeId,
      });
  };
  const seekControl = useAudioSeekControl({
    position,
    duration,
    seek,
    title: asset.title || "audio",
  });
  const toggle = () =>
    playing
      ? playback.pause()
      : playback.play(String(asset.id), { startAt: seconds, audioNodeId });
  if (previewOnly)
    return (
      <View style={[audioStyles.audio, tiled && audioStyles.tileAudio]}>
        <View style={tiled && audioStyles.waveform}>
          <AudioWaveform
            height={tiled ? "100%" : 60}

            spectrum={spectrum.data}
            recordingPreview={Boolean(recordingPreview)}
            peaks={recordingPreview?.peaks}
          />
        </View>
        <Icon name="play" size={32} color={tokens.mediaTileControl} />
        <Text style={[layout.muted, tiled && audioStyles.duration]}>
          {time(duration)}
        </Text>
      </View>
    );
  return (
    <View style={[audioStyles.audio, tiled && audioStyles.tileAudio]}>
      {error ? (
        <>
          <Text accessibilityRole="alert" style={layout.text}>
            Audio unavailable.
          </Text>
          <Button
            emphasis="link"
            style={styles.retry}
            onPress={() => {
              void playback.play(String(asset.id), {
                startAt: seconds,
                audioNodeId,
              });
            }}
          >
            Retry audio
          </Button>
        </>
      ) : (
        <>
          {!tiled && <Text style={layout.text}>{asset.title || "Audio"}</Text>}
          {expanded ? (
            <Button
              {...seekControl}
              emphasis="bare"
              style={styles.expandedWaveform}
            >
              <View pointerEvents="none" style={{ width: "100%" }}>
                <AudioWaveform
                  height={220}

                  spectrum={spectrum.data}
            recordingPreview={Boolean(recordingPreview)}
            peaks={recordingPreview?.peaks}
                  progress={current ? (duration ? position / duration : 0) : undefined}
                />
              </View>
            </Button>
          ) : (
            <View style={tiled && audioStyles.waveform}>
              <AudioWaveform
                height={tiled ? "100%" : 60}

                spectrum={spectrum.data}
            recordingPreview={Boolean(recordingPreview)}
            peaks={recordingPreview?.peaks}
                progress={current ? (duration ? position / duration : 0) : undefined}
              />
            </View>
          )}
          {expanded && (
            <View style={styles.skip}>
              <Button
                emphasis="bare"
                accessibilityLabel="Skip back 10 seconds"
                onPress={() => seek(position - 10)}
              >
                −10s
              </Button>
              <Button
                emphasis="bare"
                accessibilityLabel="Skip ahead 10 seconds"
                onPress={() => seek(position + 10)}
              >
                +10s
              </Button>
            </View>
          )}
          <View style={tiled ? audioStyles.audioControls : undefined}>
            <MediaPlayControl
              size={tiled ? "small" : "regular"}
              background={tiled ? tokens.mediaTileControl : "rgba(0, 0, 0, 0.5)"}
              foreground="#ffffff"
              playing={playing}
              label={
                playing
                  ? "Pause audio"
                  : seconds !== undefined
                    ? `Play from ${time(seconds)}`
                    : "Play audio"
              }
              onPress={() => {
                void toggle();
              }}
            />
            <Text style={[layout.muted, tiled && audioStyles.controlTime]}>
              {time(current ? position : duration)}
            </Text>
          </View>
          {onReply && (
            <Button
              emphasis="link"
              onPress={() => {
                playback.pause();
                onReply(position);
              }}
            >
              Reply at {time(position)}
            </Button>
          )}
        </>
      )}
    </View>
  );
}
export function VideoMedia({
  source,
  asset,
  tiled = false,
  autoPlay = false,
  previewOnly = false,
}: {
  previewOnly?: boolean;
  source: Source;
  asset: MediaAsset;
  tiled?: boolean;
  autoPlay?: boolean;
}) {
  const video = useRef<VideoView>(null);
  const started = useRef(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const player = useVideoPlayer(null, (player) => {
    player.timeUpdateEventInterval = 0.25;
  });
  const { status } = useEvent(player, "statusChange", {
    status: player.status,
  });
  useEffect(() => {
    void player.replaceAsync({ ...source, useCaching: false }).catch(() => {});
  }, [player, source]);
  const progress = useEvent(player, "timeUpdate");
  const activate = useMediaPlayback(
    `video:${asset.id}`,
    {
      pause: () => player.pause(),
      position: progress?.currentTime ?? 0,
      seek: (seconds) => {
        player.currentTime = seconds;
      },
    },
    status === "readyToPlay",
  );
  useEffect(() => {
    if (autoPlay && status === "readyToPlay" && !started.current) {
      started.current = true;
      activate();
      player.play();
    }
  }, [autoPlay, status, player, activate]);
  useEffect(() => {
    const listener = player.addListener("playingChange", (event) => {
      if (event.isPlaying) activate();
    });
    return () => listener.remove();
  }, [player, activate]);
  // Web replacement loads through the mounted VideoView, including after errors.
  return (
    <View style={tiled && { height: "100%" }}>
      <VideoView
        ref={video}
        player={player}
        nativeControls={!previewOnly && status !== "error"}
        crossOrigin="use-credentials"
        fullscreenOptions={{ enable: true }}
        style={[
          styles.video,
          tiled
            ? { height: "100%" }
            : {
                aspectRatio:
                  asset.width && asset.height
                    ? asset.width / asset.height
                    : 16 / 9,
              },
          status === "error" && styles.failedVideo,
        ]}
        accessibilityLabel={asset.title || "Video"}
      />
      {status === "error" ? (
        <View style={styles.mediaError}>
          <Text style={layout.text}>Video unavailable.</Text>
          {!previewOnly && (
            <Button
              emphasis="link"
              style={styles.retry}
              onPress={() => {
                void player
                  .replaceAsync({ ...source, useCaching: false })
                  .catch(() => {});
              }}
            >
              Retry video
            </Button>
          )}
        </View>
      ) : (
        <>
          {!previewOnly && Platform.OS === "ios" && tiled && (
            <Button
              accessibilityLabel="Full screen video"
              emphasis="ghost"
              style={styles.fullscreen}
              onPress={() => {
                setFullscreenError(false);
                void video.current
                  ?.enterFullscreen()
                  .catch(() => setFullscreenError(true));
              }}
            >
              <Icon name="frameCorners" size={20} />
            </Button>
          )}
          {fullscreenError && (
            <Text accessibilityRole="alert" style={layout.text}>
              Could not open full screen. Try again.
            </Text>
          )}
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  expandedWaveform: {
    padding: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    width: "100%",
  },
  skip: { flexDirection: "row", justifyContent: "space-between" },
  retry: { minHeight: 48 },
  failedVideo: { opacity: 0 },
  mediaError: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: tokens.paper,
  },
  video: { width: "100%" },
  fullscreen: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 44,
    backgroundColor: tokens.paper,
  },
});
