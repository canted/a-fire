import type * as React from "react";

type AudioRecordingPhase =
  | "idle"
  | "requesting"
  | "ready"
  | "recording"
  | "stopping"
  | "review";

const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/webm",
] as const;

/** Owns microphone permission, recording, review URLs, metering, and cleanup.
 * The composition surface owns attachment, playback, and presentation. */
export function createUseMediaRecording({ useEffect, useRef, useState }: Pick<typeof React, "useRef" | "useState"> & { useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => void }, useRecordingPeaks: (stream: MediaStream | null, active: boolean, retainHistory?: boolean) => number[]) {
return function useMediaRecording({ presentation, finishRecordingRequest = 0, retainHistory = true }: {
  presentation: "post" | "attachment";
  finishRecordingRequest?: number;
  retainHistory?: boolean;
}) {
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [recordingPhase, setRecordingPhase] =
    useState<AudioRecordingPhase>("idle");
  const [recordingError, setRecordingError] = useState<string>();
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedFile, setRecordedFile] = useState<File>();
  const [recordedUrl, setRecordedUrl] = useState<string>();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingPeaks = useRecordingPeaks(recordingStreamRef.current, recordingPhase === "recording", retainHistory);
  const generation = useRef(0);
  const preparation = useRef<Promise<void> | null>(null);
  const recordingStartedAtRef = useRef(0);
  const discardRecordingRef = useRef(false);
  useEffect(() => {
    if (!recordedFile) {
      setRecordedUrl(undefined);
      return;
    }
    const nextUrl = URL.createObjectURL(recordedFile);
    setRecordedUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [recordedFile]);
  useEffect(() => {
    if (recordingPhase !== "recording") return;
    const updateDuration = () => {
      setRecordingSeconds(
        Math.max(
          0,
          Math.floor((Date.now() - recordingStartedAtRef.current) / 1000),
        ),
      );
    };
    updateDuration();
    const interval = window.setInterval(updateDuration, 250);
    return () => window.clearInterval(interval);
  }, [recordingPhase]);
  useEffect(
    () => () => {
      generation.current++;
      discardRecordingRef.current = true;
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === "recording") recorder.stop();
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );
  function resetRecording() {
    setRecordedFile(undefined);
    setRecordingError(undefined);
    setRecordingSeconds(0);
    setRecordingPhase("idle");
  }

  function stopRecordingTracks() {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  }

  function closeRecording() {
    generation.current++;
    preparation.current = null;
    discardRecordingRef.current = true;
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    stopRecordingTracks();
    mediaRecorderRef.current = null;
    resetRecording();
    setRecordingOpen(false);
  }

  async function acquireRecorder() {
    const attempt = ++generation.current;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setRecordingError(
        presentation === "attachment" ? "Recording isn’t available in this browser. Close the recorder to attach an audio file." : "Recording isn’t available in this browser. You can upload or paste audio instead.",
      );
      return;
    }
    setRecordingError(undefined);
    setRecordingPhase("requesting");
    discardRecordingRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (discardRecordingRef.current || attempt !== generation.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      recordingStreamRef.current = stream;
      const mimeType =
        typeof MediaRecorder.isTypeSupported === "function"
          ? RECORDING_MIME_TYPES.find((type) =>
              MediaRecorder.isTypeSupported(type),
            )
          : undefined;
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const releaseStream = () => {
        stream.getTracks().forEach(track => track.stop());
        if (recordingStreamRef.current === stream) recordingStreamRef.current = null;
      };
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        releaseStream();
        if (attempt !== generation.current) return;
        setRecordingError(
          "The recording stopped unexpectedly. Please try again.",
        );
        setRecordingPhase("idle");
      };
      recorder.onstop = () => {
        releaseStream();
        if (mediaRecorderRef.current === recorder) mediaRecorderRef.current = null;
        if (discardRecordingRef.current || attempt !== generation.current) return;
        const type = (recorder.mimeType || mimeType || "audio/webm")
          .split(";", 1)[0]
          .trim()
          .toLowerCase();
        const blob = new Blob(chunks, { type });
        if (blob.size === 0) {
          setRecordingError("Nothing was recorded. Please try again.");
          setRecordingPhase("idle");
          return;
        }
        const extension = type.includes("mp4")
          ? "m4a"
          : type.includes("ogg")
            ? "ogg"
            : "webm";
        setRecordedFile(
          new File([blob], `Quick recording.${extension}`, { type }),
        );
        setRecordingPhase("review");
      };
      mediaRecorderRef.current = recorder;
      setRecordingPhase("ready");
    } catch (reason) {
      if (attempt !== generation.current) return;
      stopRecordingTracks();
      setRecordingPhase("idle");
      setRecordingError(
        reason instanceof DOMException && reason.name === "NotAllowedError"
          ? (presentation === "attachment" ? "Microphone access was declined. Try again, or close the recorder to attach an audio file." : "Microphone access was declined. You can try again, upload, or paste audio instead.")
          : "Couldn’t start recording. Check your microphone and try again.",
      );
    }
  }

  function prepareRecording(): Promise<void> {
    if (mediaRecorderRef.current) return Promise.resolve();
    if (preparation.current) return preparation.current;
    const pending = acquireRecorder().finally(() => {
      if (preparation.current === pending) preparation.current = null;
    });
    preparation.current = pending;
    return pending;
  }

  async function startRecording() {
    if (!mediaRecorderRef.current) {
      const pending = prepareRecording();
      const attempt = generation.current;
      await pending;
      if (attempt !== generation.current) return;
    }
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "inactive" || discardRecordingRef.current) return;
    try {
      recorder.start();
      recordingStartedAtRef.current = Date.now();
      setRecordingSeconds(0);
      setRecordingPhase("recording");
    } catch {
      stopRecordingTracks();
      mediaRecorderRef.current = null;
      setRecordingPhase("idle");
      setRecordingError("Couldn’t start recording. Check your microphone and try again.");
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder?.state !== "recording") return;
    setRecordingPhase("stopping");
    recorder.stop();
  }

  const handledFinishRequest = useRef(0);
  useEffect(() => {
    if (!finishRecordingRequest || handledFinishRequest.current === finishRecordingRequest) return;
    if (recordingPhase === "requesting") return;
    handledFinishRequest.current = finishRecordingRequest;
    if (mediaRecorderRef.current?.state === "recording") {
      setRecordingPhase("stopping");
      mediaRecorderRef.current.stop();
    } else if (recordingPhase === "idle") setRecordingOpen(false);
  }, [finishRecordingRequest, recordingPhase]);

  return { recordingOpen, setRecordingOpen, recordingPhase, recordingError,
    recordingSeconds, recordedFile, recordedUrl, recordingPeaks,
    resetRecording, closeRecording, prepareRecording, startRecording, stopRecording };
}

}
