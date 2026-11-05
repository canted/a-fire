import useSWR from "swr";
import { fetchEntry } from "../lib/api/entries";
import { client } from "../lib/api";

/** Shared authorized entry snapshot; reply subscriptions remain in useEntryReplies. */
export function useEntryQuery(id: string | undefined) {
  return useSWR(id ? ["post", id] : null, () => fetchEntry(client, id!));
}
