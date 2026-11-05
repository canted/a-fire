import { useMediaSource } from "./useMediaSource";

/** Native image requests need the same session as API requests; web uses cookies. */
export function useIdentityImage(url?: string | null) {
  return useMediaSource(url).data;
}
