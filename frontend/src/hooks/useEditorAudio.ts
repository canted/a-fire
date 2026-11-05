import useSWRMutation from "swr/mutation";
import { fetchMediaAsset } from "./useMediaSource";
export type EditorAudioPresentation = {
  title: string;
  duration: number;
  createdAt?: string;
  ready: boolean;
};
/** Serialize display metadata only; playback stays in the session player. */
export function useEditorAudio() {
  return useSWRMutation(
    "editor-audio-presentation",
    async (_, { arg }: { arg: string }): Promise<EditorAudioPresentation> => {
      if (!/^[1-9]\d*$/.test(arg)) throw new Error("Audio unavailable");
      const asset = await fetchMediaAsset("audio", arg);
      return {
        title: asset.title || "Audio",
        duration: (asset.duration_ms ?? 0) / 1000,
        createdAt: asset.created_at,
        ready: asset.processing_status === "ready",
      };
    },
    { populateCache: false, revalidate: false },
  );
}
