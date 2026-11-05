import { entryReplyDocument } from "../lib/entryReplyDraft";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import useSWRMutation from "swr/mutation";
import {
  createReply,
  fetchReplies,
  publishReply,
  type Reply,
} from "../lib/api/entries";
import { useEntryQuery } from "./useEntryQuery";
import { useMentionTargets } from "./useMentionTargets";
import {
  mergeRepliesForCache,
  mergeReplyIntoPostResponse,
} from "../lib/replyCache";
import { mentionDocument } from "../lib/plainMentionDraft";
import { randomUuid } from "../lib/randomId";
import { ApiError } from "../lib/api/transport";
import {
  acknowledgeChatSend,
  type ChatAttachment,
} from "../lib/chatComposition";
import { releaseChatFile } from "../lib/chatFiles";
import { cable } from "../lib/cable";
import { client } from "../lib/api";
import { useAttachmentUpload } from "./useAttachmentUpload";
import type { useRoomDraft } from "./useRooms";
import type { FeedbackType } from "../lib/feedback";

export function useEntryReplies(id: string) {
  const post = useEntryQuery(id);
  const pages = useSWRInfinite(
    (index, previous) => {
      const page =
        index === 0
          ? post.data?.replies.pagination.next_page
          : previous?.pagination.next_page;
      return page ? ["post-replies", id, page] : null;
    },
    ([, , page]: [string, string, number]) => fetchReplies(client, id, page),
    { initialSize: 0, revalidateFirstPage: false },
  );
  const replies = useMemo(
    () =>
      mergeRepliesForCache(
        post.data?.replies.data ?? [],
        (pages.data ?? []).flatMap((page) => page.data),
      ).replies,
    [post.data, pages.data],
  );
  const refresh = useRef(() => {});
  refresh.current = () => {
    void Promise.allSettled([post.mutate(), pages.mutate()]);
  };
  useEffect(() => {
    const subscription = cable
      .getCableConsumer()
      .subscriptions.create<{ type: string; entry_id?: number; reply?: Reply }>(
        { channel: "EntryChannel", id },
        {
          received: (event) => {
            if (event.entry_id && String(event.entry_id) !== id) return;
            if (event.type === "reply" && event.reply)
              void post.mutate(
                (current) =>
                  mergeReplyIntoPostResponse(current, event.reply!).response,
                { revalidate: false },
              );
            else refresh.current();
          },
          connected: () => refresh.current(),
        },
      );
    const off = cable.onCableConnect(() => refresh.current());
    const resume = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        cable.ensureCableConnected();
        refresh.current();
      }
    });
    return () => {
      subscription.unsubscribe();
      off();
      resume.remove();
    };
  }, [id, post.mutate]);
  return {
    entry: post,
    pages,
    replies,
    loadMore: () => pages.setSize((size) => size + 1),
    hasMore:
      (pages.data?.at(-1)?.pagination ?? post.data?.replies.pagination)
        ?.next_page != null,
  };
}

/** Reply persistence adapter for ReplyComposer and the shared scoped draft owner. */
export function useEntryComposition(
  id: string,
  room: string | undefined,
  draft: ReturnType<typeof useRoomDraft>,
  entry: ReturnType<typeof useEntryReplies>,
  enabled: boolean,
  feedback?: FeedbackType | null,
) {
  const [error, setError] = useState<string | null>(null);
  const [lastSentId, setLastSentId] = useState<string>();
  const { mutate } = useSWRConfig();
  const mentions = useMentionTargets(room, enabled);
  const create = useSWRMutation(["reply-create", id], () =>
    createReply(client, id, { status: "draft", feedback_type: feedback }),
  );
  const upload = useAttachmentUpload("reply", id);
  const publish = useSWRMutation(
    ["reply-publish", id],
    async (
      _,
      {
        arg,
      }: {
        arg: { replyId: number; content: ReturnType<typeof mentionDocument>; revision: number };
      },
    ) => {
      const payload = { content: arg.content, feedback_type: feedback };
      // Publication persists content atomically; retries must not edit an already published Reply.
      return publishReply(client, id, arg.replyId, { ...payload, expected_revision: arg.revision });
    },
  );
  async function replaceAttachment(attachment?: ChatAttachment) {
    if (draft.read().operation || draft.read().pending) {
      releaseChatFile(attachment);
      return;
    }
    const previous = draft.read().attachment;
    // Like the existing inline reply adapter, a changed attachment starts a new
    // unpublished draft. No reply is published or edited by picker interaction.
    draft.update((value) => ({
      attachment,
      staging: undefined,
      revision: value.revision + 1,
    }));
    if (previous?.id !== attachment?.id) releaseChatFile(previous);
    setError(null);
  }
  async function send() {
    const current = draft.read();
    if (
      !enabled ||
      current.operation ||
      (!current.pending && !current.text.trim() && !current.attachment)
    )
      return;
    const owner = Symbol("reply-send");
    const pending = current.pending ?? {
      body: current.text,
      content: entryReplyDocument(current),
      nonce: randomUuid(),
      revision: current.revision,
      attachment: current.attachment,
    };
    draft.update({
      pending,
      operation: { owner, stage: pending.attachment ? "uploading" : "sending" },
    });
    setError(null);
    let publishing = false;
    try {
      let staging = current.staging ?? {
        nonce: pending.nonce,
        blockId: randomUuid(),
      };
      draft.update({ staging });
      if (!staging.id) {
        const reply = await create.trigger();
        staging = { ...staging, id: Number(reply.id), serverRevision: reply.revision ?? 0 };
        draft.update({ staging });
      }
      if (pending.attachment && !staging.node) {
        const node = await upload.trigger({
          attachment: pending.attachment,
          draftId: staging.id!,
          blockId: staging.blockId,
        });
        staging = { ...staging, node };
        draft.update({ staging });
      }
      const content = staging.node
        ? {
            type: "doc" as const,
            content: [...(pending.content.content ?? []), staging.node],
          }
        : pending.content;
      draft.update({ operation: { owner, stage: "sending" } });
      publishing = true;
      const reply = await publish.trigger({ replyId: staging.id!, content, revision: staging.serverRevision ?? 0 });
      draft.update((value) => acknowledgeChatSend(value, pending));
      releaseChatFile(pending.attachment);
      setLastSentId(String(reply.id));
      void entry.entry
        .mutate((value) => mergeReplyIntoPostResponse(value, reply).response, {
          revalidate: false,
        })
        .catch(() => {});
      void mutate((key) =>
        ["room", "room-home", "room-history", "wall", "home", "unseen", "board"].includes(
          String(Array.isArray(key) ? key[0] : key),
        ),
      ).catch(() => {});
    } catch (reason) {
      if (
        !publishing ||
        (reason instanceof ApiError &&
          reason.status >= 400 &&
          reason.status < 500 &&
          reason.status !== 408)
      )
        draft.update({ pending: null });
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not send the reply. Try again.",
      );
    } finally {
      draft.update((value) =>
        value.operation?.owner === owner ? { operation: undefined } : {},
      );
    }
  }
  const stage = draft.operation?.stage ?? "idle";
  return {
    mentions,
    error,
    setError,
    lastSentId,
    stage,
    busy: stage !== "idle",
    send,
    replaceAttachment,
  };
}
