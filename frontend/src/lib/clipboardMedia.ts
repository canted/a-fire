const AUDIO_EXTENSION_CONTENT_TYPES = new Map([
  ["aac", "audio/aac"],
  ["aif", "audio/aiff"],
  ["aiff", "audio/aiff"],
  ["m4a", "audio/x-m4a"],
  ["mp3", "audio/mpeg"],
  ["oga", "audio/ogg"],
  ["ogg", "audio/ogg"],
  ["opus", "audio/opus"],
  ["wav", "audio/wav"],
  ["wave", "audio/vnd.wave"],
  ["webm", "audio/webm"],
]);

const AUDIO_CONTENT_TYPE_EXTENSIONS = new Map([
  ["audio/aac", "aac"],
  ["audio/aiff", "aiff"],
  ["audio/x-aiff", "aiff"],
  ["audio/mp4", "m4a"],
  ["audio/m4a", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/ogg", "ogg"],
  ["application/ogg", "ogg"],
  ["audio/opus", "opus"],
  ["audio/vnd.wave", "wav"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/webm", "webm"],
]);

type ClipboardItemLike = {
  types: readonly string[];
  getType: (type: string) => Promise<Blob>;
};

type ClipboardReader = {
  read?: () => Promise<readonly ClipboardItemLike[]>;
};

function baseContentType(value?: string | null) {
  return (value ?? "")
    .replace(/^web\s+/i, "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function getFileExtension(file: { name: string }) {
  const normalizedName = file.name.toLowerCase();
  return normalizedName.includes(".")
    ? normalizedName.replace(/^.*\./, "")
    : "";
}

function getAudioContentTypeFromName(file: { name: string }) {
  return AUDIO_EXTENSION_CONTENT_TYPES.get(getFileExtension(file)) ?? null;
}

export function isAudioFile(file: { name: string; type: string }) {
  return (
    file.type.startsWith("audio/") || (!file.type.startsWith("video/") && Boolean(getAudioContentTypeFromName(file)))
  );
}

export function attachmentContentType(file: { name: string; type: string }, blockType: string) {
  if (blockType !== "audio") return file.type;
  const normalizedContentType = baseContentType(file.type);
  return (normalizedContentType.startsWith("audio/")
    ? normalizedContentType
    : getAudioContentTypeFromName(file)) || file.type;
}

export function normalizeAttachmentFile(file: File, blockType: string) {
  const inferredContentType = attachmentContentType(file, blockType);
  if (inferredContentType === file.type) return file;

  return new File([file], file.name, {
    type: inferredContentType,
    lastModified: file.lastModified,
  });
}

export async function readClipboardAudioFile(
  clipboard: ClipboardReader | null | undefined =
    typeof navigator === "undefined" ? undefined : navigator.clipboard,
): Promise<File | null> {
  if (typeof clipboard?.read !== "function") {
    throw new Error("clipboard audio reading is unavailable");
  }

  const items = await clipboard.read();
  for (const item of items) {
    for (const type of item.types) {
      const contentType = baseContentType(type);
      if (!contentType.startsWith("audio/") && contentType !== "application/ogg") continue;

      const blob = await item.getType(type);
      if (blob instanceof File && isAudioFile(blob)) {
        return normalizeAttachmentFile(blob, "audio");
      }

      const resolvedContentType = baseContentType(blob.type) || contentType;
      const extension = AUDIO_CONTENT_TYPE_EXTENSIONS.get(resolvedContentType);
      if (!extension) continue;
      const fileContentType = resolvedContentType === "application/ogg" ? "audio/ogg" : resolvedContentType;
      return new File([blob], `Pasted audio.${extension}`, {
        type: fileContentType,
        lastModified: Date.now(),
      });
    }
  }

  return null;
}

function isClipboardMediaFile(file: File | null): file is File {
  if (!file) return false;
  return (
    file.type.startsWith("image/") ||
    file.type.startsWith("video/") ||
    isAudioFile(file)
  );
}

export function getClipboardMediaFiles(event: ClipboardEvent, { allowFiles = false } = {}): File[] {
  const acceptsFile = (file: File | null): file is File => Boolean(file && (allowFiles || isClipboardMediaFile(file)));
  const items = Array.from(event.clipboardData?.items ?? []);
  const itemFiles = items
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter(acceptsFile);

  if (itemFiles.length > 0) return itemFiles;

  return Array.from(event.clipboardData?.files ?? []).filter(
    acceptsFile,
  );
}
