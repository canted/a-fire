import { revalidateProjectLists } from "./projectListCache";
import { useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import {
  fetchEntryDraft,
  saveEntryContent,
  publishEntry,
  type CreateDraftEntryOptions,
} from "../lib/api/entryDraft";
import { entryPublicationCache } from "../lib/entryPublicationCache";
import type { FeedbackRequest } from "../lib/feedback";
import type { TiptapDoc } from "../lib/tiptap";
import { client } from "../lib/api";

/** Shared Expo save/publish owner for Room copies and Round contributions. */
export function useEntryDraft({
  existing,
  round: activity,
  origin,
  feedback,
}: {
  existing?: string;
  round?: string | number;
  origin?: CreateDraftEntryOptions["creationOrigin"];
  feedback?: FeedbackRequest;
}) {
  const { mutate, cache } = useSWRConfig();
  const key = [
    "draft-post",
      activity,
    origin ?? undefined,
    existing,
  ];
  const draft = useSWR(
    existing ? key : null,
    () => fetchEntryDraft(client, existing!),
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );
  const save = useSWRMutation(
    ["post-content", ...key],
    async (_, { arg }: { arg: { content: TiptapDoc; title: string; expectedRevision: number } }) => {
      if (!draft.data) throw new Error("Draft is not ready.");
      const result = await saveEntryContent(
        client,
        draft.data.id,
        arg.content,
        draft.data.subject,
        draft.data.link_preview,
        feedback ?? draft.data.feedback_request,
        "mixed_media",
        { ...draft.data.format_data, title: arg.title },
        arg.expectedRevision,
      );
      await draft.mutate(result, { revalidate: false });
      return result;
    },
  );
  const publish = useSWRMutation(["post-publish", ...key], async () => {
    if (!draft.data) throw new Error("Draft is not ready.");
    const result = await publishEntry(client, draft.data.id);
    await entryPublicationCache(
      { draftQueryKey: key },
      {
        removeQueries: ({ queryKey }) =>
          mutate(
            (value) =>
              Array.isArray(value) &&
              queryKey.every((part, index) => value[index] === part),
            undefined,
            { revalidate: false },
          ),
        invalidateQueries: ({ queryKey }) =>
          mutate(
            (value) =>
              Array.isArray(value) &&
              queryKey.every((part, index) => value[index] === part),
          ),
      },
    )(result);
    void revalidateProjectLists(cache).catch(() => {});
    void mutate(
      (value) =>
        value === "projects" ||
        (Array.isArray(value) &&
          ["room", "room-walls", "project", "home"].includes(String(value[0]))),
    ).catch(() => {});
    return result;
  });
  const flight = useRef<ReturnType<typeof publish.trigger> | null>(null);
  return {
    draft,
    save,
    publish,
    busy: publish.isMutating,
    submit(persist: () => Promise<unknown>) {
      if (flight.current) return flight.current;
      const request = Promise.resolve()
        .then(persist)
        .then(() => publish.trigger())
        .finally(() => {
          flight.current = null;
        });
      flight.current = request;
      return request;
    },
  };
}
