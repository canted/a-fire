import { useEffect, useRef } from "react";
import { useGlobalSearchParams, usePathname } from "expo-router";
import { audioTimestampTarget } from "../lib/audioTimestamp";
import { useAudioPlayback } from "./useAudioPlayback";
import { useSession } from "./useSession";

/** Timestamp URLs use the session player's existing authorized SWR transport. */
export function useAudioDeepLinkPlayback() {
  const params = useGlobalSearchParams();
  const path = usePathname();
  const session = useSession();
  const playback = useAudioPlayback();
  const play = useRef(playback.play);
  play.current = playback.play;
  const handled = useRef<string | undefined>(undefined);
  const search = new URLSearchParams();
  for (const key of ["audio", "t", "audioNode"])
    if (typeof params[key] === "string") search.set(key, params[key]);
  const target = audioTimestampTarget(search);
  // Reply URLs seed the draft; they must not start playback while composing.
  const key =
    target && !path.endsWith("/new-reply") && !path.endsWith("/audio-reply")
      ? `${path}?${search}`
      : undefined;
  useEffect(() => {
    if (!session.ready || !session.signedIn || !key) {
      handled.current = undefined;
      return;
    }
    if (handled.current === key) return;
    handled.current = key;
    const target = audioTimestampTarget(
      new URLSearchParams(key.slice(key.indexOf("?") + 1)),
    );
    if (target)
      void play.current(target.audioAssetId, {
        startAt: target.seconds,
        audioNodeId: target.audioNodeId,
      });
  }, [key, session.ready, session.signedIn, session.draftScope]);
}
