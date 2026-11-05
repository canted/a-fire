import type { AudioSpectrum } from "../../../types/audio-spectrum";
import { fetchAudioSpectrum } from "./useAudioSpectrum";
import { Platform } from "react-native";
import useSWR from "swr";
import { mediaLink } from "../lib/contentLinks";
import { apiBaseUrl, client } from "../lib/api";

/** One authenticated source adapter for identity images and document media. */
export function useMediaSource(value?: string | null) {
  const origin = new URL(apiBaseUrl).origin;
  const uri = mediaLink(value, origin);
  return useSWR(
    uri ? ["media-source", uri] : null,
    async ([, url]: [string, string]) => {
      if (Platform.OS === "web" || new URL(url).origin !== origin)
        return { uri: url };
      const token = await client.getAccessToken();
      return {
        uri: url,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      };
    },
  );
}

export type MediaAsset = {
  id: number;
  title?: string;
  created_at?: string;
  processing_status: string;
  playback_url?: string;
  download_url?: string;
  poster_url?: string;
  duration_ms?: number;
  spectrum?: AudioSpectrum;
  width?: number;
  height?: number;
  waveform_peaks?: number[];
  error_message?: string;
};
export const fetchMediaAsset = async (
  kind: "audio" | "video",
  id: string,
): Promise<MediaAsset> => {
  const [asset, spectrum] = await Promise.all([
    client.get<MediaAsset>(`/v1/${kind}-assets/${id}`),
    kind === "audio"
      ? fetchAudioSpectrum(Number(id)).catch(() => undefined)
      : undefined,
  ]);
  return spectrum ? { ...asset, spectrum } : asset;
};
export function useMediaAsset(kind: "audio" | "video", id: unknown) {
  const valid = /^\d+$/.test(String(id));
  return useSWR<MediaAsset>(
    valid ? ["media-asset", kind, String(id)] : null,
    () => fetchMediaAsset(kind, String(id)),
    {
      refreshInterval: (data) =>
        data &&
        ["pending", "processing", "uploading"].includes(data.processing_status)
          ? 3000
          : 0,
    },
  );
}
