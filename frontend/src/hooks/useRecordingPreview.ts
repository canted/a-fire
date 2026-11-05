import { useEffect } from "react";
import useSWR from "swr";
import { recordingPreviewKey, type RecordingPreview } from "../lib/recordingPreview";

/** Session cache only; the complete spectrum retires the temporary recording contour. */
export function useRecordingPreview(id: number | undefined, complete = false) {
  const query = useSWR<RecordingPreview>(id ? recordingPreviewKey(id) : null, null);
  const { mutate, data } = query;
  useEffect(() => {
    if (complete && data) void mutate(undefined, { revalidate: false });
  }, [complete, data, mutate]);
  return complete ? undefined : data;
}
