import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { AudioWaveform } from "./AudioWaveform";
import { Button } from "../../components/Button";
import { PopupMenu } from "../../components/PopupMenu";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";
import type { useChatRecording } from "../../hooks/useChatRecording";

/** The stopped file transfers immediately; amplitude samples are local preview only. */
export function RecordingDrawer({
  recording,
  open,
  onClose,
}: {
  recording: ReturnType<typeof useChatRecording> & {
    prepare?: () => Promise<void>;
    preparationMessage?: string;
  };
  open: boolean;
  onClose: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const transferred = useRef<string | undefined>(undefined);
  const current = useRef({ recording, onClose });
  current.current = { recording, onClose };
  useEffect(() => {
    if (!open || !current.current.recording.prepare) return;
    void current.current.recording.prepare();
    return () => { void current.current.recording.cancel(); };
  }, [open]);
  const reduced = useReducedMotion();
  const shape = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(shape, {
      toValue: recording.recording ? 1 : 0,
      duration: reduced ? 0 : 180,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [recording.recording, reduced, shape]);
  const id = recording.review?.id;
  useEffect(() => {
    if (!open) setFailed(false);
  }, [open]);
  useEffect(() => {
    if (!open || !id || transferred.current === id) return;
    transferred.current = id;
    setTransferring(true);
    setFailed(false);
    void current.current.recording
      .useRecording()
      .then((success) => {
        if (success) current.current.onClose();
        else setFailed(true);
      })
      .finally(() => setTransferring(false));
  }, [open, id]);
  const busy =
    recording.preparing ||
    transferring ||
    (Boolean(recording.review) && !failed);
  const seconds = recording.recording || busy ? recording.seconds : 0;
  return (
    <PopupMenu
      mode="drawer"
      title="Audio recording"
      open={open}
      actions={[]}
      dismissDisabled={transferring || Boolean(recording.review)}
      onClose={() => {
        void recording.cancel();
        onClose();
      }}
    >
      <View style={styles.content}>
        <Text style={[layout.text, styles.duration]}>
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </Text>
        <View style={styles.preview}>
          {recording.recording ? (
            <AudioWaveform
              recordingPreview
              previewColor={tokens.ink}
              peaks={[
                ...Array<number>(
                  Math.max(0, 160 - recording.peaks.length),
                ).fill(0),
                ...recording.peaks.slice(-160),
              ]}
              height={48}
            />
          ) : (
            <Text style={[layout.muted, styles.message]}>
              {busy
                ? recording.preparing
                  ? recording.preparationMessage ?? "Preparing audio…"
                  : "Adding recording…"
                : "Start audio recording"}
            </Text>
          )}
        </View>
        {recording.error && (
          <Text accessibilityRole="alert" style={layout.text}>
            {recording.error}
          </Text>
        )}
        {failed && (
          <Button
            disabled={transferring}
            onPress={() => {
              setTransferring(true);
              void recording
                .useRecording()
                .then((success) => {
                  if (success) onClose();
                })
                .finally(() => setTransferring(false));
            }}
          >
            Retry attachment
          </Button>
        )}
        <Button
          emphasis="bare"
          shape="circle"
          style={styles.control}
          disabled={busy || failed}
          accessibilityLabel={
            recording.recording
              ? "Stop recording and attach"
              : "Start audio recording"
          }
          onPress={() => {
            void (recording.recording ? recording.finish() : recording.start());
          }}
        >
          <Animated.View
            style={{
              width: shape.interpolate({
                inputRange: [0, 1],
                outputRange: [44, 24],
              }),
              height: shape.interpolate({
                inputRange: [0, 1],
                outputRange: [44, 24],
              }),
              borderRadius: shape.interpolate({
                inputRange: [0, 1],
                outputRange: [22, 5],
              }),
              backgroundColor: tokens.orange,
            }}
          />
        </Button>
      </View>
    </PopupMenu>
  );
}
const styles = StyleSheet.create({
  content: {
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  message: { textAlign: "center" },
  duration: { fontSize: 24, fontVariant: ["tabular-nums"] },
  preview: {
    width: "100%",
    height: 48,
    justifyContent: "center",
    alignItems: "stretch",
  },
  control: { width: 64, height: 64, borderWidth: 2, borderColor: tokens.muted },
});
