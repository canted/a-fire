import type { uploadContent } from './api/contentUpload';
import type { TiptapNode } from './tiptap';
import { randomUuid } from './randomId';
export function chatAttachmentNode(uploaded: Awaited<ReturnType<typeof uploadContent>>, blockType: string): TiptapNode {
  if ("audioAsset" in uploaded && uploaded.audioAsset) {
    return {
      type: "audio",
      attrs: {
        audioAssetId: uploaded.audioAsset.id,
        title: uploaded.audioAsset.title,
        status: uploaded.audioAsset.status,
        nodeId: randomUuid(),
      },
    };
  }

  if ("videoAsset" in uploaded && uploaded.videoAsset) {
    return {
      type: "video",
      attrs: {
        videoAssetId: uploaded.videoAsset.id,
        title: uploaded.videoAsset.title,
        status: uploaded.videoAsset.status,
        durationMs: uploaded.videoAsset.durationMs,
        width: uploaded.videoAsset.width,
        height: uploaded.videoAsset.height,
        thumbnailUrl: uploaded.videoAsset.thumbnailUrl,
      },
    };
  }

  if ("file" in uploaded && uploaded.file?.url) {
    if (blockType === "attach" && "name" in uploaded.file) {
      return {
        type: "file",
        attrs: { src: uploaded.file.url, filename: uploaded.file.name, size: uploaded.file.size, contentType: uploaded.file.contentType },
      };
    }
    return {
      type: "image",
      attrs: {
        src: uploaded.file.url,
        ...("width" in uploaded.file ? { width: uploaded.file.width, height: uploaded.file.height } : {}),
      },
    };
  }

  throw new Error("The attachment could not be prepared.");
}
