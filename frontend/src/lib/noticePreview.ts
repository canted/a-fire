import { hasTiptapNodeType, plainTextFromTiptap } from "./tiptap";
import type { TiptapDoc } from "./tiptap";
import type { Notice } from "./api/noticeTypes";

export function noticePreviewText(notice: Notice): string {
  if (notice.type === "introduction") {
    return notice.message.trim();
  }

  const documents = notice.type === "reply" || notice.replyId
    ? [notice.replyContent, notice.content]
    : [notice.content, notice.replyContent];

  for (const document of documents) {
    const text = plainTextFromTiptap(document).trim();
    if (text) return text;
  }

  const excerpt = notice.message.trim();
  if (excerpt) return excerpt;

  for (const document of documents) {
    const mediaPreview = mediaPreviewText(document);
    if (mediaPreview) return mediaPreview;
  }

  return "";
}

function mediaPreviewText(document: TiptapDoc | null | undefined): string {
  if (!document) return "";

  const hasImage = hasTiptapNodeType(document, "image");
  const hasAudio = hasTiptapNodeType(document, "audio");
  const hasVideo = hasTiptapNodeType(document, "video");

  if (hasImage && hasAudio) return "posted image and audio";
  if (hasImage && hasVideo) return "posted image and video";
  if (hasAudio && hasVideo) return "posted audio and video";
  if (hasImage) return "posted an image";
  if (hasAudio) return "posted audio";
  if (hasVideo) return "posted a video";

  return "";
}
