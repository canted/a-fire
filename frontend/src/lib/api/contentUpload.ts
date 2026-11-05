import type { SessionTransport } from "./transport";
import { randomUuid } from "../randomId";

export type UploadTarget = { type: "post" | "page" | "reply" | "chat-message"; id: number | string };

export type UploadedAudioAsset = {
  id: number;
  title: string;
  status: string;
  metadataUrl: string;
  playbackUrl: string;
  downloadUrl: string;
  filename?: string;
  contentType?: string;
};

export type UploadedVideoAsset = {
  id: number;
  title: string;
  status: string;
  metadataUrl: string;
  playbackUrl: string;
  downloadUrl: string;
  filename?: string;
  contentType?: string;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  thumbnailUrl?: string | null;
};

type UploadResponse = {
  success?: number;
  message?: string;
  file?: { url?: string; filename?: string; byte_size?: number; content_type?: string; width?: number; height?: number };
  audio_asset?: {
    id?: number;
    title?: string;
    processing_status?: string;
    filename?: string;
    content_type?: string;
    metadata_url?: string;
    playback_url?: string;
    download_url?: string;
  };
  video_asset?: {
    id?: number;
    title?: string;
    processing_status?: string;
    filename?: string;
    content_type?: string;
    metadata_url?: string;
    playback_url?: string;
    download_url?: string;
    poster_url?: string | null;
    duration_ms?: number | null;
    width?: number | null;
    height?: number | null;
  };
};

export async function uploadContent(client: Pick<SessionTransport, "post">, target: UploadTarget, file: { name: string; type: string; size: number }, blockType: string, appendFile: (form: FormData) => void, blockId = randomUuid()) {
  const formData = new FormData();
  appendFile(formData);

  if (target.type === "post") {
    formData.append("entry_id", String(target.id));
  } else if (target.type === "page") {
    formData.append("page_id", String(target.id));
  } else if (target.type === "reply") {
    formData.append("reply_id", String(target.id));
  } else if (target.type === "chat-message") {
    formData.append("chat_message_id", String(target.id));
  }

  formData.append("block_id", blockId);
  formData.append("block_type", blockType);

  const json = await client.post<UploadResponse>("/v1/uploads", formData);
  if (json?.success !== 1) {
    throw new Error(json?.message || "Upload failed");
  }

  if (blockType === "audio") {
    if (
      !json.audio_asset?.id ||
      !json.audio_asset.metadata_url ||
      !json.audio_asset.playback_url ||
      !json.audio_asset.download_url
    ) {
      throw new Error(json?.message || "Upload failed");
    }

    const audioAsset: UploadedAudioAsset = {
      id: json.audio_asset.id,
      title: json.audio_asset.title || file.name,
      status: json.audio_asset.processing_status || "pending",
      metadataUrl: json.audio_asset.metadata_url,
      playbackUrl: json.audio_asset.playback_url,
      downloadUrl: json.audio_asset.download_url,
    };
    if (json.audio_asset.filename) audioAsset.filename = json.audio_asset.filename;
    if (json.audio_asset.content_type) audioAsset.contentType = json.audio_asset.content_type;

    return {
      success: 1,
      audioAsset,
    };
  }

  if (blockType === "video") {
    if (
      !json.video_asset?.id ||
      !json.video_asset.metadata_url ||
      !json.video_asset.playback_url ||
      !json.video_asset.download_url
    ) {
      throw new Error(json?.message || "Upload failed");
    }

    const videoAsset: UploadedVideoAsset = {
      id: json.video_asset.id,
      title: json.video_asset.title || file.name,
      status: json.video_asset.processing_status || "pending",
      metadataUrl: json.video_asset.metadata_url,
      playbackUrl: json.video_asset.playback_url,
      downloadUrl: json.video_asset.download_url,
      durationMs: json.video_asset.duration_ms ?? null,
      width: json.video_asset.width ?? null,
      height: json.video_asset.height ?? null,
      thumbnailUrl: json.video_asset.poster_url ?? null,
    };
    if (json.video_asset.filename) videoAsset.filename = json.video_asset.filename;
    if (json.video_asset.content_type) videoAsset.contentType = json.video_asset.content_type;

    return {
      success: 1,
      videoAsset,
    };
  }

  if (!json.file?.url) {
    throw new Error(json?.message || "Upload failed");
  }

  if (blockType === "attach") {
    return {
      success: 1,
      file: {
        url: json.file.url,
        title: json.file.filename || file.name,
        name: json.file.filename || file.name,
        size: json.file.byte_size ?? file.size,
        contentType: json.file.content_type || file.type || "application/octet-stream",
      },
    };
  }

  return {
    success: 1,
    file: {
      url: json.file.url,
      ...(json.file.width && json.file.height ? { width: json.file.width, height: json.file.height } : {}),
    },
  };
}
