import { createHash } from "node:crypto"

export const PRIVATE_MEDIA_CACHE_MAX_AGE_SECONDS = 0
export const PRIVATE_MEDIA_CACHE_CONTROL = "private, no-cache, must-revalidate"

export function mediaEtag(identity: string): string {
  return `"${createHash("sha256").update(identity).digest("hex")}"`
}

export function matchesMediaEtag(header: string | undefined, etag: string) {
  return Boolean(header?.split(",").some(value => value.trim().replace(/^W\//, "") === etag))
}

export function mediaDisposition(filename: string, contentType: string, download = false) {
  const safeInline = /^(image\/(jpeg|png|gif|webp|avif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/i.test(contentType)
  const safeName = filename.replace(/[\x00-\x1f\x7f"\\]/g, "_").replace(/[^\x20-\x7e]/g, "_")
  return `${!download && safeInline ? "inline" : "attachment"}; filename="${safeName}"`
}
