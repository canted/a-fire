import { appRoutes } from "./appRoutes";
import { normalizeAudioSeconds } from "./audioTimestamp";

export type AudioTrack = {
  id: string;
  title: string;
  playbackUrl: string;
  downloadUrl: string;
  filename?: string | null;
  contentType?: string | null;
  durationMs?: number | null;
  waveformPeaks?: number[] | null;
  replyAvailable?: boolean;
  sourceType?: "Post" | "Reply" | "Note" | "Page" | "ChatMessage" | null;
  sourceId?: string | null;
  parentPostId?: string | null;
  parentChatMessageId?: string | null;
  roomId?: string | null;
  audioNodeId?: string | null;
};

export type PlayTrackOptions = {
  startAt?: number;
};

export function replyHrefForTrack(track: AudioTrack, seconds: number) {
  if (track.replyAvailable === false) return null;
  const timestamp = normalizeAudioSeconds(seconds);

  if (track.sourceType === "Post" && track.sourceId) {
    return appRoutes.entryNewReplyAt(track.sourceId, { audioAssetId: track.id, seconds: timestamp });
  }

  if (track.sourceType === "Reply" && track.parentPostId) {
    return appRoutes.entryNewReplyAt(track.parentPostId, { audioAssetId: track.id, seconds: timestamp });
  }



  if ((track.sourceType === "Note" || track.sourceType === "Page") && track.sourceId) {
    return appRoutes.noteAudioReply(track.sourceId, {
      audioAssetId: track.id,
      audioNodeId: track.audioNodeId ?? undefined,
      seconds: timestamp,
    });
  }

  return null;
}
