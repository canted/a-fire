import useSWRMutation from "swr/mutation";
import { fetchMediaAsset } from "./useMediaSource";
export type EditorVideoPresentation = {
  title: string;
  status: string;
  width?: number;
  height?: number;
  duration?: number;
  poster?: string;
};
/** Display metadata only. The existing media renderer owns authorized playback. */
export function useEditorVideo() {
  return useSWRMutation(
    "editor-video-presentation",
    async (_, { arg }: { arg: string }): Promise<EditorVideoPresentation> => {
      if (!/^[1-9]\d*$/.test(arg)) throw new Error("Video unavailable");
      const asset = await fetchMediaAsset("video", arg);
      return {
        title: asset.title || "Video",
        status: asset.processing_status,
        width: asset.width,
        height: asset.height,
        duration: asset.duration_ms,
        poster: asset.poster_url,
      };
    },
    { populateCache: false, revalidate: false },
  );
}
