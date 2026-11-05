import { retryFailedMediaAssets } from "./retryFailedMedia"
export { parseRetryFailedMediaArgs as parseRetryFailedAudioArgs, startOfUtcDay } from "./retryFailedMedia"

/** Compatibility entry point for the existing audio recovery command and callers. */
export function retryFailedAudioAssets(
  prisma: Parameters<typeof retryFailedMediaAssets>[0],
  boss: Parameters<typeof retryFailedMediaAssets>[1],
  options: Parameters<typeof retryFailedMediaAssets>[3] = {},
) {
  return retryFailedMediaAssets(prisma, boss, "audio", options)
}
