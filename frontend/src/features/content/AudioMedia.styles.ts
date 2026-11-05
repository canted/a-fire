import { StyleSheet } from "react-native";
import { tokens } from "../../styles/tokens";

/** Shared tile geometry keeps local capture and processed audio in the same slots. */
export const audioStyles = StyleSheet.create({
  tileAudio: {
    backgroundColor: tokens.surfaceMuted,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
  waveform: {
    position: "absolute",
    left: 8,
    right: 8,
    top: 36,
    bottom: 8,
  },
  loadingWaveform: {
    justifyContent: "center",
  },
  loadingMessage: {
    fontFamily: "Lato",
    fontWeight: "400",
    fontSize: 11,
    lineHeight: 14,
    color: tokens.muted,
  },
  audioControls: {
    position: "absolute",
    top: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  controlTime: {
    fontFamily: "Lato",
    fontWeight: "400",
    fontSize: 12,
    lineHeight: 20,
    color: tokens.muted,
  },
  duration: {
    position: "absolute",
    bottom: 4,
    right: 4,
    fontSize: 11,
    lineHeight: 14,
    padding: 0,
  },
  audio: { backgroundColor: tokens.paper, gap: 6, padding: 12 },
  pendingDuration: { marginLeft: 32 },
});
