import { expect, it } from "vitest";
import { getRecordingPreview, retainRecordingPreview } from "../../../../frontend/src/lib/recordingPreview";
import type { ChatAttachment } from "../../../../frontend/src/lib/chatComposition";

it("keeps a compact full-duration preview outside the attachment and document payload", () => {
  const file: ChatAttachment = { id: "take", uri: "blob:take", name: "take.webm", type: "audio/webm", size: 100 };
  const original = JSON.stringify(file);
  const peaks = Array<number>(2000).fill(0);
  peaks[0] = 0.2; peaks[1000] = 0.6; peaks[1999] = 1;
  retainRecordingPreview(file, peaks, 100);
  const preview = getRecordingPreview(file)!;
  expect(preview.duration).toBe(100);
  expect(preview.peaks).toHaveLength(800);
  expect(preview.peaks[0]).toBe(0.2);
  expect(preview.peaks[400]).toBe(0.6);
  expect(preview.peaks[799]).toBe(1);
  expect(JSON.stringify(file)).toBe(original);
  expect(getRecordingPreview({ ...file })).toBeUndefined();
});
