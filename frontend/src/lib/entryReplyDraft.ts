import {
  buildAudioTimestampDoc,
  buildAudioTimestampPath,
} from "./audioTimestamp";
import { mentionDocument } from "./plainMentionDraft";
import type { RoomDraft } from "./chatComposition";

/** Timestamp context never replaces a typed, staged or pending reply. */
export function seedAudioReply(
  draft: RoomDraft,
  post: string,
  audio: string,
  seconds: number,
): Partial<RoomDraft> {
  if (
    !/^[1-9]\d*$/.test(audio) ||
    draft.text.trim() ||
    draft.attachment ||
    draft.pending ||
    draft.staging ||
    draft.prefix
  )
    return {};
  return {
    prefix: buildAudioTimestampDoc({
      audioAssetId: audio,
      seconds,
      href: buildAudioTimestampPath(`/app/entries/${post}`, {
        audioAssetId: audio,
        seconds,
      }),
    }),
    revision: draft.revision + 1,
  };
}
export function entryReplyDocument(draft: RoomDraft) {
  const document = mentionDocument(draft);
  return draft.prefix
    ? {
        ...document,
        content: [...(draft.prefix.content ?? []), ...(document.content ?? [])],
      }
    : document;
}
