import useSWR from "swr";
import { client } from "../lib/api";
import { externalPreviewUrl } from "../lib/linkPreviewDetection";
import { resolveLinkPreview } from "../lib/api/linkPreviews";
/** Public URL metadata only; never resolve private app destinations as previews. */
export function useLinkPreview(input: string | null) {
  const url = externalPreviewUrl(input);
  return useSWR(url ? ["link-preview", url] : null, () => resolveLinkPreview(client, url!), {
    revalidateOnFocus: false, dedupingInterval: 60 * 60 * 1000,
  });
}
