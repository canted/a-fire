export function formatAudioTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";

  const roundedSeconds = Math.floor(totalSeconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const audioAttachmentDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatAudioAttachmentDate(value?: string | Date | null) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return audioAttachmentDateFormatter.format(date);
}

export function formatAudioShortDuration(durationMs?: number | null) {
  if (durationMs === null || durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return null;

  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const totalHours = Math.max(1, Math.round(totalMinutes / 60));
  return `${totalHours}h`;
}

export function displayAudioTitle(title?: string | null) {
  const trimmed = title?.trim() || "";
  const withoutExtension = trimmed.replace(/\.(?:aac|aif|aiff|amr|flac|m4a|mp3|oga|ogg|opus|wav|webm)$/i, "");
  return withoutExtension.trim() || "Untitled audio";
}
