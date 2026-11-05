import { useEffect, useRef, useState } from "react";
import { isAudioFile } from "../lib/clipboardMedia";
import type { TiptapNode } from "../lib/tiptap";
import { useAttachmentUpload } from "./useAttachmentUpload";
import { useChatRecording } from "./useChatRecording";
import { pickChatFile, releaseChatFile } from "../lib/chatFiles";
import type { ChatAttachment } from "../lib/chatComposition";

/** Rich editors share Chat file/recording/upload owners and retain failed insertions. */
export function useDocumentAttachments(
  id: number | undefined,
  onInsert: (node: TiptapNode) => Promise<void>,
  onError: (message: string | undefined) => void,
  options: {
    target?: "page" | "post";
    scope?: string;
    media?: readonly string[];
  } = {},
) {
  const [attachment, setAttachment] = useState<ChatAttachment>();
  const [working, setWorking] = useState(false);
  const flight = useRef(false);
  const file = useRef(attachment);
  file.current = attachment;
  const staged = useRef<TiptapNode | undefined>(undefined);
  const upload = useAttachmentUpload(
    options.target || "page",
    options.scope || String(id),
  );
  const replace = async (next?: ChatAttachment) => {
    if (
      next &&
      options.media &&
      !options.media.includes(
        isAudioFile(next) ? "audio" : next.type.split("/")[0],
      )
    ) {
      releaseChatFile(next);
      throw new Error(
        `Choose ${options.media.join(", ")} media for this contribution.`,
      );
    }
    releaseChatFile(file.current);
    staged.current = undefined;
    file.current = next;
    setAttachment(next);
  };
  const recording = useChatRecording(async (next) => {
    await replace(next);
    await insert();
  }, onError);
  useEffect(() => () => releaseChatFile(file.current), []);
  const pick = async (kind: "file" | "photo" | "camera") => {
    if (flight.current) return;
    flight.current = true;
    setWorking(true);
    onError(undefined);
    try {
      const next = await pickChatFile(kind);
      if (next) {
        await replace(next);
        await uploadAndInsert();
      }
    } catch (reason) {
      onError(
        reason instanceof Error ? reason.message : "Could not attach the file. Try again.",
      );
    } finally {
      flight.current = false;
      setWorking(false);
    }
  };
  const uploadAndInsert = async () => {
    if (!file.current || !id) return;
    const selected = file.current;
    staged.current ??= await upload.trigger({
      attachment: selected,
      draftId: id,
      blockId: selected.id,
    });
    await onInsert(staged.current);
    await replace(undefined);
  };
  const insert = async () => {
    if (flight.current || !file.current || !id) return;
    flight.current = true;
    setWorking(true);
    onError(undefined);
    try {
      await uploadAndInsert();
    } catch (reason) {
      onError(
        reason instanceof Error
          ? reason.message
          : "Could not insert the attachment. Try again.",
      );
    } finally {
      flight.current = false;
      setWorking(false);
    }
  };
  const busy =
    working ||
    recording.recording ||
    recording.preparing ||
    Boolean(recording.review);
  return {
    attachment,
    recording,
    busy,
    pending: busy || Boolean(attachment),
    pick,
    insert,
    remove: () => replace(undefined),
  };
}
