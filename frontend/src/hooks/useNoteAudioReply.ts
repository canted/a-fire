import { useMemo, useSyncExternalStore } from "react";
import useSWRMutation from "swr/mutation";
import {
  fetchNote,
  insertNoteContentBlocksAfterAudio,
} from "../lib/api/notes";
import {
  buildAudioTimestampDoc,
  buildAudioTimestampPath,
  hasAudioReplyContent,
} from "../lib/audioTimestamp";
import { scopedDrafts } from "../lib/scopedDrafts";
import { randomUuid } from "../lib/randomId";
import { findDocumentNode } from "../lib/documentNodeIdentity";
import type { TiptapDoc } from "../lib/tiptap";
import { client } from "../lib/api";
import { useSession } from "./useSession";
import { useNote } from "./useNotes";
import { useMediaAsset } from "./useMediaSource";

type ReplyDraft = {
  content: TiptapDoc;
  nodeId: string;
  operation?: Promise<void>;
};
/** Session-scoped rich reply draft, sharing the canonical Note insertion contract. */
export function useNoteAudioReply(
  page: string,
  audio: string,
  audioNode: string | undefined,
  seconds: number,
) {
  const note = useNote(page);
  const asset = useMediaAsset("audio", audio);
  const { draftScope } = useSession();
  const key = `note-audio-reply:${page}:${audio}:${audioNode ?? ""}:${seconds}`;
  const createDraft = (): ReplyDraft => {
    const nodeId = `audio-reply-${randomUuid()}`;
    const href = buildAudioTimestampPath(`/app/note/${page}`, {
      audioAssetId: audio,
      audioNodeId: audioNode,
      seconds,
    });
    return {
      nodeId,
      content: buildAudioTimestampDoc({
        audioAssetId: audio,
        audioNodeId: audioNode,
        href,
        seconds,
        nodeId,
      }),
    };
  };
  const store = useMemo(
    () =>
      scopedDrafts<ReplyDraft>(
        draftScope,
        createDraft,
        (value) =>
          Boolean(value.operation) || hasAudioReplyContent(value.content),
      ),
    [draftScope, page, audio, audioNode, seconds],
  );
  const state = useSyncExternalStore(
    (listener) => store.subscribe(key, listener),
    () => store.read(key),
    () => store.read(key),
  );
  const publish = useSWRMutation(
    ["note-audio-reply", key],
    async (_, { arg }: { arg: TiptapDoc }) => {
      const current = store.read(key);
      if (current.operation) return current.operation;
      if (!hasAudioReplyContent(arg))
        throw new Error(
          "Add text or an attachment before publishing your reply.",
        );
      if (!findDocumentNode(arg.content, current.nodeId))
        throw new Error(
          "Keep the audio timestamp in your reply so it can return to the source.",
        );
      const operation = (async () => {
        // A lost response must not append the same reply twice on retry.
        const latest = await fetchNote(client, page);
        const saved = findDocumentNode(latest.content.content, current.nodeId)
          ? latest
          : await insertNoteContentBlocksAfterAudio(client, page, {
              blocks: arg.content ?? [],
              audioAssetId: audio,
              audioNodeId: audioNode,
            });
        await note.query.mutate(saved, { revalidate: false });
      })();
      store.write(key, { ...current, content: arg, operation });
      try {
        await operation;
        store.write(key, createDraft());
      } finally {
        const value = store.read(key);
        if (value.operation === operation)
          store.write(key, { ...value, operation: undefined });
      }
    },
  );
  return {
    note: note.query,
    asset,
    content: state.content,
    nodeId: state.nodeId,
    busy: Boolean(state.operation) || publish.isMutating,
    change: (content: TiptapDoc) => {
      const value = store.read(key);
      if (!value.operation) store.write(key, { ...value, content });
    },
    publish: (content: TiptapDoc) => publish.trigger(content),
  };
}
