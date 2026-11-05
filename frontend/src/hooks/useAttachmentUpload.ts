import { trackUpload } from "../lib/analytics";
import { useSWRConfig } from "swr";
import { getRecordingPreview, recordingPreviewKey } from "../lib/recordingPreview";
import { appendPickedFile } from "../lib/chatFiles";
import useSWRMutation from "swr/mutation";
import {
  uploadContent,
  type UploadTarget,
} from "../lib/api/contentUpload";
import { chatAttachmentNode } from "../lib/chatAttachmentNode";
import {
  attachmentContentType,
  isAudioFile,
  normalizeAttachmentFile,
} from "../lib/clipboardMedia";
import type { ChatAttachment } from "../lib/chatComposition";
import { client } from "../lib/api";

export function useAttachmentUpload(
  targetType: UploadTarget["type"],
  scope: string,
) {
  const { mutate } = useSWRConfig();
  const upload = useSWRMutation(
    ["content-upload", targetType, scope],
    async (
      _,
      {
        arg,
      }: {
        arg: { attachment: ChatAttachment; draftId: number; blockId: string };
      },
    ) => {
      const file = arg.attachment;
      const type = isAudioFile(file)
        ? "audio"
        : file.type.startsWith("video/")
          ? "video"
          : file.type.startsWith("image/")
            ? "image"
            : "attach";
      const mime =
        attachmentContentType(file, type) || "application/octet-stream";
      const started = Date.now();
      trackUpload('started', type, targetType);
      const result = await uploadContent(
        client,
        { type: targetType, id: arg.draftId },
        { ...file, type: mime },
        type,
        (form) => {
          appendPickedFile(
            form,
            "file",
            {
              ...file,
              file: file.file
                ? normalizeAttachmentFile(file.file, type)
                : undefined,
            },
            mime,
          );
        },
        arg.blockId,
      ).catch(error => {
        trackUpload('failed', type, targetType, Date.now() - started);
        throw error;
      });
      trackUpload('succeeded', type, targetType, Date.now() - started);
      const preview = getRecordingPreview(file);
      if (preview && "audioAsset" in result && result.audioAsset) {
        await mutate(recordingPreviewKey(result.audioAsset.id), preview, { revalidate: false });
      }
      return chatAttachmentNode(result, type);
    },
  );
  return upload;
}
