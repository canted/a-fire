export type AudioAssetRecord = {
  id: string;
  title: string;
  processingStatus: string;
  durationMs: number | null;
  createdAt: string | null;
  waveformPeaks: number[];
  errorMessage: string | null;
  playbackUrl: string;
  downloadUrl: string;
  filename: string | null;
  contentType: string | null;
  replyAvailable?: boolean;
  sourceType: "Post" | "Reply" | "Note" | "Page" | "ChatMessage" | null;
  sourceId: string | null;
  parentPostId: string | null;
  parentChatMessageId: string | null;
  roomId: string | null;
};

export type AudioAssetResponse = {
  id: string | number;
  title?: string | null;
  processing_status?: string | null;
  duration_ms?: number | null;
  created_at?: string | null;
  waveform_peaks?: number[] | null;
  error_message?: string | null;
  playback_url?: string | null;
  download_url?: string | null;
  filename?: string | null;
  content_type?: string | null;
  reply_available?: boolean;
  source_type?: "Post" | "Reply" | "Note" | "Page" | string | null;
  source_id?: string | number | null;
  parent_entry_id?: string | number | null;
  parent_chat_message_id?: string | number | null;
  room_id?: string | number | null;
};

export function audioAssetRecord(response: AudioAssetResponse): AudioAssetRecord {
  return {
        id: String(response.id),
        title: response.title || "Untitled audio",
        processingStatus: response.processing_status || "processing",
        durationMs: response.duration_ms ?? null,
        createdAt: response.created_at ?? null,
        waveformPeaks: response.waveform_peaks ?? [],
        errorMessage: response.error_message ?? null,
        playbackUrl: response.playback_url || "",
        downloadUrl: response.download_url || "",
        filename: response.filename ?? null,
        contentType: response.content_type ?? null,
        replyAvailable: response.reply_available,
        sourceType:
          response.source_type === "Post" || response.source_type === "Reply" || response.source_type === "Note" || response.source_type === "Page" || response.source_type === "ChatMessage"
            ? response.source_type
            : null,
        sourceId: response.source_id === null || response.source_id === undefined ? null : String(response.source_id),
        parentPostId:
          response.parent_entry_id === null || response.parent_entry_id === undefined ? null : String(response.parent_entry_id),
        parentChatMessageId:
          response.parent_chat_message_id === null || response.parent_chat_message_id === undefined ? null : String(response.parent_chat_message_id),
        roomId: response.room_id === null || response.room_id === undefined ? null : String(response.room_id),
  };
}
