import { revalidateProjectLists } from "./projectListCache";
import { useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import { client } from "../lib/api";
import type { EntryShow } from "../lib/api/entries";
import { fetchMemberships } from "../lib/api/profile";

type Keeps = { groups: Array<{ reply_ids: number[] }> };
/** One retained feedback block per author card; originals are never removed. */
export function useEntryReplySave(post?: EntryShow) {
  const identity = useSWR("memberships", () => fetchMemberships(client));
  const { mutate, cache } = useSWRConfig();
  const flight = useRef<Promise<void> | null>(null);
  const [feedback, setFeedback] = useState<string>();
  const author = Boolean(post && identity.data?.user.id === post.user.id);
  const available = Boolean(author && post?.can_keep_replies && post.keep_project_id && post.source_entry_id);
  const path = `/v1/projects/${post?.keep_project_id}/reply-keeps/${post?.id}`;
  const keeps = useSWR<Keeps>(available ? ["entry-reply-keeps", post?.id] : null, () => client.get<Keeps>(path));
  const isSaved = (ids: number[]) => Boolean(ids.length && keeps.data?.groups.some(group => ids.every(id => group.reply_ids.includes(id))));
  const mutation = useSWRMutation(["entry-reply-toggle", post?.id], async (_, { arg }: { arg: { reply_ids: number[]; saved: boolean } }) => {
    if (!available) throw new Error("The private source is unavailable.");
    return client.post<Keeps>(path, arg);
  });
  function toggle(ids: number[]) {
    if (flight.current) return flight.current;
    const saved = !isSaved(ids);
    setFeedback(undefined);
    const pending = mutation.trigger({ reply_ids: ids, saved }).then(async result => {
      await keeps.mutate(result, { revalidate: false });
      void revalidateProjectLists(cache).catch(() => {});
      void mutate(key => key === "projects" || (Array.isArray(key) && ["home", "project", "room-home"].includes(String(key[0])))).catch(() => {});
      setFeedback(saved ? "Replies saved to your source and shown in this room." : "Replies unstarred and removed from your source.");
    }).catch((error: unknown) => setFeedback(error instanceof Error ? error.message : "Could not update saved replies. Try again.")).finally(() => { flight.current = null; });
    flight.current = pending;
    return pending;
  }
  return { available, busy: mutation.isMutating || keeps.isLoading, feedback, clearFeedback: () => setFeedback(undefined), isSaved, toggle };
}
