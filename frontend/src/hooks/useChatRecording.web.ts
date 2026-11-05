import { retainRecordingPreview } from "../lib/recordingPreview";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { createUseMediaRecording } from "../lib/mediaRecording";
import { createUseRecordingPeaks } from "../lib/recordingPeaks";
import type { ChatAttachment } from "../lib/chatComposition";
import { browserChatFile, releaseChatFile } from "../lib/chatFiles";
import { usePauseMediaPlayback } from "./useMediaPlayback";
const useMediaRecording = createUseMediaRecording(
  { useEffect, useRef, useState },
  createUseRecordingPeaks({ useEffect, useState }),
);

/** The React 19 adapter uses the same browser recorder as the existing app. */
export function useChatRecording(
  attach: (file: ChatAttachment) => Promise<void>,
  report: (error: string) => void,
) {
  const recording = useMediaRecording({ presentation: "attachment", retainHistory: true });
  const pausePlayback = usePauseMediaPlayback();
  const current = useRef(recording);
  current.current = recording;
  useFocusEffect(useCallback(() => () => current.current.closeRecording(), []));
  useEffect(() => {
    if (recording.recordingError) report(recording.recordingError);
  }, [recording.recordingError, report]);
  useEffect(() => {
    const hide = () => {
      if (
        document.hidden &&
        ["requesting", "ready", "recording"].includes(current.current.recordingPhase)
      )
        current.current.closeRecording();
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  async function useRecording() {
    if (!recording.recordedFile) return;
    const file = browserChatFile(recording.recordedFile);
    retainRecordingPreview(file, recording.recordingPeaks, recording.recordingSeconds);
    try {
      await attach(file);
      recording.closeRecording();
      return true;
    } catch (error) {
      releaseChatFile(file);
      report(
        error instanceof Error
          ? error.message
          : "Could not attach recording. Try again.",
      );
      return false;
    }
  }
  return {
    prepare: async () => {
      pausePlayback();
      await recording.prepareRecording();
    },
    preparationMessage: recording.recordingPhase === "stopping" ? "Finishing recording…" : "Opening microphone…",
    start: async () => {
      pausePlayback();
      await recording.startRecording();
    },
    finish: async () => recording.stopRecording(),
    cancel: async () => recording.closeRecording(),
    useRecording,
    review: recording.recordedUrl
      ? { uri: recording.recordedUrl, id: recording.recordedUrl }
      : undefined,
    peaks: recording.recordingPeaks,
    error: recording.recordingError,
    preparing:
      recording.recordingPhase === "requesting" ||
      recording.recordingPhase === "stopping",
    recording: recording.recordingPhase === "recording",
    seconds: recording.recordingSeconds,
  };
}
