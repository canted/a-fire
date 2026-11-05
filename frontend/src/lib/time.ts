// Hermes supports Chat's date/clock formatting, but not RelativeTimeFormat.
// Importing the portable Chat helpers must not initialize the browser-only API.
let relativeFormatter: Intl.RelativeTimeFormat | undefined;
const compactDateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const clockTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function formatRelativeTime(date: Date): string {
  const rtf = relativeFormatter ??= new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const now = Date.now();
  const diff = date.getTime() - now;
  const abs = Math.abs(diff);

  const minutes = Math.round(abs / 60000);
  if (minutes < 60) {
    return rtf.format(Math.sign(diff) * minutes, "minute");
  }

  const hours = Math.round(abs / 3600000);
  if (hours < 24) {
    return rtf.format(Math.sign(diff) * hours, "hour");
  }

  const days = Math.round(abs / 86400000);
  return rtf.format(Math.sign(diff) * days, "day");
}

export function formatCompactRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const abs = Math.abs(diff);

  if (abs < 60000) return "now";

  const minutes = Math.floor(abs / 60000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(abs / 3600000);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(abs / 86400000);
  if (days < 7) return `${days}d`;

  const weeks = Math.floor(days / 7);
  if (weeks <= 12) return `${weeks}w`;

  return compactDateFormatter.format(date);
}

export function formatChatTimestamp(date: Date): string {
  if (Date.now() - date.getTime() < DAY_IN_MS) {
    return clockTimeFormatter.format(date);
  }
  return formatCompactRelativeTime(date);
}

export function parseTimestamp(value: string | Date | undefined | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  // Some backends send timestamps without a timezone; assume UTC in that case.
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    const coerced = new Date(`${value}Z`);
    if (!Number.isNaN(coerced.getTime())) return coerced;
  }
  return null;
}
