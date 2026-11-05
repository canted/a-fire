import useSWR from "swr";
import { AUDIO_SPECTRUM_VERSION, type AudioSpectrum } from "../../../types/audio-spectrum";
import { client } from "../lib/api";

export const fetchAudioSpectrum = (id: number) =>
  client.get<AudioSpectrum>(`/v1/audio-assets/${id}/spectrum`);
export function useAudioSpectrum(
  id: number | undefined,
  initial?: AudioSpectrum,
) {
  const currentInitial = initial?.version === AUDIO_SPECTRUM_VERSION ? initial : undefined;
  const query = useSWR(
    id ? ["audio-spectrum", AUDIO_SPECTRUM_VERSION, id] : null,
    () => fetchAudioSpectrum(id!),
    {
      fallbackData: currentInitial,
      revalidateOnMount: !currentInitial,
      refreshInterval: (value) => (value?.status === "pending" ? 3000 : 0),
    },
  );
  // A fresh paired metadata read must win over an older pending cache entry.
  return { ...query, data: currentInitial?.status === "ready" ? currentInitial : query.data };
}
