import { useAudioSeekControl } from "../../hooks/useAudioSeekControl";
import { StyleSheet, Text, View } from "react-native";
import { useIsFocused } from "expo-router/react-navigation";
import { useAudioPlayback } from "../../hooks/useAudioPlayback";
import { useAudioSpectrum } from "../../hooks/useAudioSpectrum";
import { useContentLink } from "../../hooks/useContentLink";
import { replyHrefForTrack } from "../../lib/audioPlayback";
import { formatAudioTimestamp } from "../../lib/audioTimestamp";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { AudioWaveform } from "./AudioWaveform";
import { tokens } from "../../styles/tokens";
import { layout } from "../../styles/layout";

export function AudioPlayerWidget() {
  const focused = useIsFocused();
  const playback = useAudioPlayback();
  const spectrum = useAudioSpectrum(
    playback.track ? Number(playback.track.id) : undefined,
  );
  const links = useContentLink();
  const seekControl = useAudioSeekControl({
    position: playback.position,
    duration: playback.duration,
    seek: playback.seek,
    title: playback.track?.title || "audio",
  });
  if (!focused || !playback.targetId) return null;
  const { track, position, duration } = playback;
  const reply = track ? replyHrefForTrack(track, position) : null;
  return (
    <View style={styles.clearance}>
      <View style={styles.player} testID="audio-player-widget">
        <Button
          emphasis="bare"
          style={styles.control}
          accessibilityLabel="Close audio"
          onPress={playback.close}
        >
          <Icon name="x" size={24} />
        </Button>
        <Button {...seekControl} emphasis="bare" style={styles.waveform}>
          <View pointerEvents="none" style={styles.graph}>
            <AudioWaveform
              height={32}

              spectrum={spectrum.data}
              progress={duration ? position / duration : 0}
            />
          </View>
          <Text style={[styles.time, styles.current]}>
            {playback.loading ? "Loading…" : formatAudioTimestamp(position)}
          </Text>
          <Text style={[styles.time, styles.duration]}>
            {formatAudioTimestamp(duration)}
          </Text>
        </Button>
        {reply && (
          <Button
            emphasis="bare"
            style={styles.control}
            accessibilityLabel="Reply at current time"
            onPress={() => {
              void links.open(reply);
            }}
          >
            <Icon name="replyPencil" size={24} />
          </Button>
        )}
        <Button
          emphasis="bare"
          style={styles.control}
          accessibilityLabel={playback.playing ? "Pause audio" : "Play audio"}
          onPress={playback.toggle}
        >
          <Icon name={playback.playing ? "pause" : "play"} size={24} />
        </Button>
      </View>
      {(playback.error || links.error) && (
        <Text accessibilityRole="alert" style={layout.text}>
          {playback.error || links.error}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  clearance: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  player: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 12,
    backgroundColor: tokens.surface,
    paddingHorizontal: 8,
    boxShadow: "0 5px 10px rgba(17,12,8,0.14)",
  },
  control: {
    width: 32,
    minWidth: 32,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  waveform: {
    flex: 1,
    height: 36,
    minHeight: 36,
    padding: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    overflow: "hidden",
  },
  graph: { width: "100%", height: 32, overflow: "hidden" },
  time: {
    position: "absolute",
    bottom: 2,
    fontFamily: "LatoBold",
    fontSize: 12,
    backgroundColor: tokens.paper,
    color: tokens.ink,
    paddingHorizontal: 2,
  },
  current: { left: 0 },
  duration: { right: 0 },
});
