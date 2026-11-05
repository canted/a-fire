import { retainRecordingPreview } from "../lib/recordingPreview";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { File } from "expo-file-system";
import { randomUuid } from "../lib/randomId";
import type { ChatAttachment } from "../lib/chatComposition";
import { usePauseMediaPlayback } from "./useMediaPlayback";
import { releaseChatFile } from "../lib/chatFiles";

export function useChatRecording(
  attach: (file: ChatAttachment) => Promise<void>,
  report: (error: string) => void,
) {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const status = useAudioRecorderState(recorder);
  const [peaks, setPeaks] = useState<number[]>([]);
  useEffect(() => {
    if (status.isRecording && typeof status.metering === "number") {
      const amplitude = Math.min(1, Math.max(0, 10 ** (status.metering / 20)));
      setPeaks((previous) => [...previous, amplitude]);
    }
  }, [status.isRecording, status.metering, status.durationMillis]);
  const [error, setError] = useState<string>();
  const pausePlayback = usePauseMediaPlayback();
  const [preparing, setPreparing] = useState(false);
  const generation = useRef(0);
  const [review, setReview] = useState<ChatAttachment>();
  const reviewRef = useRef<ChatAttachment | undefined>(undefined);
  const clearReview = useCallback(() => {
    releaseChatFile(reviewRef.current);
    reviewRef.current = undefined;
    setReview(undefined);
  }, []);
  const cancel = useCallback(async () => {
    generation.current++;
    clearReview();
    try {
      if (recorder.isRecording) {
        await recorder.stop();
        if (recorder.uri)
          releaseChatFile({
            id: "cancelled-recording",
            uri: recorder.uri,
            name: "Recording.m4a",
            type: "audio/mp4",
            size: 0,
          });
      }
    } catch {
      /* Released on unmount. */
    }
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
  }, [recorder, clearReview]);
  useFocusEffect(
    useCallback(
      () => () => {
        void cancel();
      },
      [cancel],
    ),
  );
  useEffect(() => {
    // Permission dialogs can temporarily deactivate the app before capture starts.
    // Stop active capture here; preparation checks foreground state before record().
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active" && recorder.isRecording) void cancel();
    });
    return () => listener.remove();
  }, [cancel, recorder]);
  async function start() {
    setError(undefined);
    clearReview();
    setPeaks([]);
    const attempt = ++generation.current;
    setPreparing(true);
    try {
      if (!(await requestRecordingPermissionsAsync()).granted)
        throw new Error(
          "Microphone access is off. Allow it in device settings, or choose an audio file.",
        );
      if (attempt !== generation.current) return;
      pausePlayback();
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      if (
        attempt !== generation.current ||
        AppState.currentState !== "active"
      ) {
        await cancel();
        return;
      }
      recorder.record();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not record audio. Try again.");
      report(
        error instanceof Error ? error.message : "Could not start recording.",
      );
    } finally {
      setPreparing(false);
    }
  }
  async function finish() {
    const attempt = generation.current;
    setPreparing(true);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      if (!recorder.uri)
        throw new Error("The recording could not be saved. Try again.");
      const file = new File(recorder.uri);
      if (attempt !== generation.current) {
        releaseChatFile({
          id: "cancelled",
          uri: file.uri,
          name: "Recording.m4a",
          type: "audio/mp4",
          size: file.size,
        });
        return;
      }
      const next = {
        id: randomUuid(),
        uri: file.uri,
        name: "Recording.m4a",
        type: "audio/mp4",
        size: file.size,
      };
      retainRecordingPreview(next, peaks, status.durationMillis / 1000);
      reviewRef.current = next;
      setReview(next);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not record audio. Try again.");
      report(
        error instanceof Error ? error.message : "Could not save recording.",
      );
    } finally {
      setPreparing(false);
    }
  }
  async function useRecording() {
    const file = reviewRef.current;
    if (!file) return;
    const attempt = generation.current;
    // The pending transfer owns the bytes; blur must not delete a future draft attachment.
    reviewRef.current = undefined;
    try {
      await attach(file);
      if (attempt === generation.current) setReview(undefined);
      return true;
    } catch (error) {
      if (attempt === generation.current) reviewRef.current = file;
      else releaseChatFile(file);
      report(
        error instanceof Error
          ? error.message
          : "Could not attach recording. Try again.",
      );
      return false;
    }
  }
  return {
    start,
    finish,
    cancel,
    useRecording,
    review,
    peaks,
    error,
    preparing,
    recording: status.isRecording,
    seconds: Math.floor(status.durationMillis / 1000),
  };
}
