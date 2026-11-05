export const VIDEO_POSTER_CONTENT_TYPE = "image/jpeg"

export function videoPosterStorageKey(videoKey: string) {
  return `${videoKey}.poster.jpg`
}

export function videoPosterFilename(filename: string) {
  const base = filename.replace(/\.[^/.]+$/, "")
  return `${base || "video"}.jpg`
}
