import { expoRouteAlias } from "../lib/expoRouteAlias";
import { useGlobalSearchParams, usePathname } from "expo-router";
import { audioTimestampTarget } from "../lib/audioTimestamp";
import { useAudioPlayback } from "./useAudioPlayback";
import { useState } from "react";
import { useRoomNavigation } from "./useRoomNavigation";
import { contentLink } from "../lib/contentLinks";
import { normalizeNavigationLink, openOutsideRouter } from "../lib/linkNavigation";

export function useContentLink() {
  const params = useGlobalSearchParams();
  const playback = useAudioPlayback();
  const pathname = usePathname();
  const navigation = useRoomNavigation();
  const [error, setError] = useState<string>();
  return {
    error,
    open: async (value: unknown) => {
      const safe = contentLink(value);
      const parsed = safe ? normalizeNavigationLink(safe) : undefined;
      const href = parsed ? expoRouteAlias(parsed) || parsed : undefined;
      if (!href) {
        setError("This link is unavailable.");
        return;
      }
      setError(undefined);
      try {
        const [path, search = ""] = href.split("?");
        if (path === pathname) {
          const target = audioTimestampTarget(
            new URLSearchParams(search.split("#")[0]),
          );
          const current = new URLSearchParams();
          for (const key of ["audio", "t", "audioNode"])
            if (typeof params[key] === "string") current.set(key, params[key]);
          const active = audioTimestampTarget(current);
          if (
            target &&
            active &&
            target.audioAssetId === active.audioAssetId &&
            target.seconds === active.seconds &&
            target.audioNodeId === active.audioNodeId
          )
            await playback.play(target.audioAssetId, {
              startAt: target.seconds,
              audioNodeId: target.audioNodeId,
            });
        }
        if (/^\/app(?:[/?#]|$)/.test(href)) navigation.destination(href);
        else await openOutsideRouter(href);
      } catch {
        setError("Could not open this link. Please try again.");
      }
    },
  };
}
