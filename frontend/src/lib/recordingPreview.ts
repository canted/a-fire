import type { ChatAttachment } from "./chatComposition";

export type RecordingPreview = { peaks: number[]; duration: number };
// Only object identities connect capture to upload. No preview enters a document,
// FormData, or persisted draft; abandoned attachments are garbage collected.
const previews = new WeakMap<ChatAttachment, RecordingPreview>();
export function retainRecordingPreview(file: ChatAttachment, peaks: number[], duration: number) {
  if (!peaks.length) return;
  const count = Math.min(800, peaks.length);
  const reduced = Array.from({ length: count }, (_, i) => {
    let peak = 0;
    for (let j = Math.floor(i * peaks.length / count); j < Math.floor((i + 1) * peaks.length / count); j++) {
      if (Number.isFinite(peaks[j])) peak = Math.max(peak, Math.min(1, Math.abs(peaks[j])));
    }
    return peak;
  });
  previews.set(file, { peaks: reduced, duration });
}
export const getRecordingPreview = (file: ChatAttachment) => previews.get(file);
export const recordingPreviewKey = (id: number) => ["local-recording-preview", id] as const;
