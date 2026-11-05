import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Keyboard, Platform } from "react-native";
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  type AudioSource,
} from "expo-audio";
import useSWRMutation from "swr/mutation";
import {
  audioAssetRecord,
  type AudioAssetResponse,
} from "../lib/api/audioAsset";
import { loadAudioMediaBlob } from "../lib/audioMediaTransfer";
import type { AudioTrack, PlayTrackOptions } from "../lib/audioPlayback";
import { mediaLink } from "../lib/contentLinks";
import { client, apiBaseUrl } from "../lib/api";
import { usePlaybackSession } from "./useMediaPlayback";

type Playback = {
  targetId?: string;
  track: AudioTrack | null;
  playing: boolean;
  loading: boolean;
  error?: string;
  position: number;
  duration: number;
  play: (
    id: string,
    options?: PlayTrackOptions & { audioNodeId?: string },
  ) => Promise<void>;
  pause: () => void;
  toggle: () => void;
  close: () => void;
  seek: (seconds: number) => void;
};
const Context = createContext<Playback | null>(null);
export function useAudioPlayback() {
  const value = useContext(Context);
  if (!value) throw new Error("AudioPlaybackProvider missing");
  return value;
}
/** One session player. Rows may recycle without disposing its source or transport. */
export function AudioPlaybackProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<AudioSource>(null);
  const player = useAudioPlayer(source, { crossOrigin: "use-credentials" });
  const status = useAudioPlayerStatus(player);
  const session = usePlaybackSession();
  const owner = useRef(Symbol("persistent-audio")).current;
  const [track, setTrack] = useState<AudioTrack | null>(null);
  const trackRef = useRef(track);
  trackRef.current = track;
  const [targetId, setTargetId] = useState<string>();
  const [requestedPlaying, setRequestedPlaying] = useState(false);
  const startedRequest = useRef<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef(0);
  const objectUrl = useRef<string | undefined>(undefined);
  const pending = useRef<{ request: number; seconds: number } | undefined>(
    undefined,
  );
  const release = useCallback(() => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = undefined;
  }, []);
  const pause = useCallback(() => {
    request.current++;
    startedRequest.current = undefined;
    setRequestedPlaying(false);
    pending.current = undefined;
    setLoading(false);
    try {
      player.pause();
    } catch {
      /* native disposal can precede cleanup */
    }
    session.paused(owner);
  }, [player, session, owner]);
  const close = useCallback(() => {
    pause();
    setSource(null);
    release();
    setTrack(null);
    setTargetId(undefined);
    trackRef.current = null;
    setError(undefined);
  }, [pause, release]);
  const previousSession = useRef(session);
  useEffect(() => {
    if (previousSession.current === session) return;
    previousSession.current = session;
    close();
  }, [session, close]);
  const transfer = useSWRMutation(
    "persistent-audio-source",
    async (
      _,
      {
        arg,
      }: {
        arg: {
          id: string;
          generation: number;
          seconds?: number;
          audioNodeId?: string;
        };
      },
    ) => {
      const record = audioAssetRecord(
        await client.get<AudioAssetResponse>(`/v1/audio-assets/${arg.id}`),
      );
      if (arg.generation !== request.current) return;
      if (record.processingStatus !== "ready" || !record.playbackUrl)
        throw new Error("Audio unavailable. Try again.");
      const origin = new URL(apiBaseUrl).origin;
      const uri = mediaLink(record.playbackUrl, origin);
      if (!uri) throw new Error("Audio unavailable.");
      const token = await client.getAccessToken();
      const blob =
        Platform.OS === "web"
          ? await loadAudioMediaBlob(client, token ?? "", uri)
          : undefined;
      if (arg.generation !== request.current) return;
      player.pause();
      release();
      const next = { ...record, audioNodeId: arg.audioNodeId };
      trackRef.current = next;
      setTrack(next);
      const seconds = arg.seconds ?? session.position(`audio:${arg.id}`) ?? 0;
      pending.current = { request: arg.generation, seconds };
      if (blob) objectUrl.current = URL.createObjectURL(blob);
      setSource({
        uri: objectUrl.current ?? uri,
        headers:
          !blob && new URL(uri).origin === origin && token
            ? { Authorization: `Bearer ${token}` }
            : undefined,
      });
    },
    { populateCache: false, revalidate: false },
  );
  const play = async (
    id: string,
    options?: PlayTrackOptions & { audioNodeId?: string },
  ) => {
    Keyboard.dismiss();
    player.pause();
    setTargetId(id);
    session.activate(`audio:${id}`, owner, pause);
    const generation = ++request.current;
    startedRequest.current = undefined;
    setRequestedPlaying(true);
    setLoading(true);
    setError(undefined);
    try {
      await transfer.trigger({
        id,
        generation,
        seconds: options?.startAt,
        audioNodeId: options?.audioNodeId,
      });
    } catch (reason) {
      if (generation !== request.current) return;
      pause();
      setSource(null);
      release();
      setError(
        reason instanceof Error
          ? reason.message
          : "Audio unavailable. Try again.",
      );
    }
  };
  useEffect(() => {
    if (status.error) {
      pending.current = undefined;
      setLoading(false);
      setRequestedPlaying(false);
      setError("Audio unavailable. Try again.");
      return;
    }
    const next = pending.current;
    if (!status.isLoaded || !next || next.request !== request.current) return;
    pending.current = undefined;
    void player
      .seekTo(
        Math.max(0, Math.min(next.seconds, status.duration || next.seconds)),
      )
      .then(() => {
        if (next.request !== request.current) return;
        setLoading(false);
        player.play();
      })
      .catch(() => {
        if (next.request === request.current) {
          setLoading(false);
          setRequestedPlaying(false);
          setError("Audio unavailable. Try again.");
        }
      });
  }, [player, source, status.isLoaded, status.error, status.duration]);
  // Transport status can briefly report paused during loading/seeking. Keep the
  // requested control state until an explicit pause, failure, or this take ends.
  useEffect(() => {
    if (!requestedPlaying || loading) return;
    if (status.playing && !status.didJustFinish) startedRequest.current = request.current;
    if (status.didJustFinish && startedRequest.current === request.current) {
      startedRequest.current = undefined;
      setRequestedPlaying(false);
      session.paused(owner);
    }
  }, [requestedPlaying, loading, status.playing, status.didJustFinish, session, owner]);
  useEffect(() => {
    if (track && (loading || status.playing))
      session.activate(`audio:${track.id}`, owner, pause);
  }, [track, loading, status.playing, session, owner, pause]);
  useEffect(() => {
    if (track) session.remember(`audio:${track.id}`, owner, status.currentTime);
  }, [track, session, owner, status.currentTime]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") pause();
    });
    return () => listener.remove();
  }, [pause]);
  useEffect(
    () => () => {
      request.current++;
      pending.current = undefined;
      session.paused(owner);
      release();
    },
    [session, owner, release],
  );
  const seek = (seconds: number) => {
    if (!Number.isFinite(seconds) || !status.isLoaded) return;
    void player
      .seekTo(Math.max(0, Math.min(seconds, status.duration)))
      .catch(() => setError("Could not seek. Try again."));
  };
  return (
    <Context.Provider
      value={{
        targetId,
        track,
        playing: requestedPlaying,
        loading,
        error,
        position: status.currentTime,
        duration: status.duration || (track?.durationMs ?? 0) / 1000,
        play,
        pause,
        close,
        seek,
        toggle: () => {
          if (requestedPlaying || loading) pause();
          else if (targetId)
            void play(targetId, {
              startAt:
                status.didJustFinish || trackRef.current?.id !== targetId
                  ? 0
                  : status.currentTime,
              audioNodeId: trackRef.current?.audioNodeId ?? undefined,
            });
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
