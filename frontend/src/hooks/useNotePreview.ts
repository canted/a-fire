import useSWR from "swr";
import { client } from "../lib/api";

export function useNotePreview(id: unknown) {
  return useSWR(
    /^\d+$/.test(String(id)) ? ["note-preview", String(id)] : null,
    async () =>
      (
        await client.get<{ note: { title?: string; icon?: string } }>(
          `/v2/notes/${id}`,
        )
      ).note,
  );
}
