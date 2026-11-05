import type { Prisma } from "@prisma/client"

type TipTapDoc = Record<string, unknown>
type TipTapNode = { type?: string; attrs?: Record<string, unknown>; content?: unknown }

const APP_UPLOAD_HOSTS = new Set(["afire.app", "www.afire.app", "localhost", "127.0.0.1"])
const APP_UPLOAD_PATH_PATTERN = /^\/api\/v1\/uploads\/(\d+)(?:\/variants\/[^/?#]+)?$/
const RAILS_ACTIVE_STORAGE_BLOB_PATH_PATTERN = /^\/rails\/active_storage\/blobs\/(?:proxy|redirect)\/([^/]+)\/[^/?#]+$/
const ABSOLUTE_APP_UPLOAD_URL_PATTERN =
  /\bhttps?:\/\/(?:www\.)?afire\.app(\/api\/v1\/uploads\/\d+(?:\/variants\/[^/?#"'<>\s)]+)?(?:[?#][^#"'<>\s)]*)?)/gi
const ABSOLUTE_RAILS_ACTIVE_STORAGE_BLOB_URL_PATTERN =
  /\bhttps?:\/\/(?:www\.)?afire\.app(\/rails\/active_storage\/blobs\/(?:proxy|redirect)\/[^/?#"'<>\s)]+\/[^?#"'<>\s)]+(?:[?#][^#"'<>\s)]*)?)/gi
const RELATIVE_RAILS_ACTIVE_STORAGE_BLOB_URL_PATTERN =
  /(^|[\s"'(=])((\/rails\/active_storage\/blobs\/(?:proxy|redirect)\/[^/?#"'<>\s)]+\/[^?#"'<>\s)]+)(?:[?#][^#"'<>\s)]*)?)/g
const RELATIVE_APP_UPLOAD_URL_PATTERN =
  /(^|[\s"'(=])((\/api\/v1\/uploads\/(\d+)(?:\/variants\/[^/?#"'<>\s)]+)?)(?:[?#][^#"'<>\s)]*)?)/g

export const CIRCLE_ICON_VARIATION_DIGEST = "icon160"
export const USER_AVATAR_VARIATION_DIGEST = "avatarStripe40"

export function uploadVariantUrl(url: string | null | undefined, variationDigest: string): string | null {
  if (!url) return null
  const normalizedUrl = normalizePrivateUploadUrl(url)
  const parsed = parsePrivateUploadUrl(normalizedUrl)
  if (!parsed) return url
  return `${parsed.basePath}/variants/${variationDigest}${parsed.suffix}`
}

export function circleIconUrl(url: string | null | undefined): string | null {
  return uploadVariantUrl(url, CIRCLE_ICON_VARIATION_DIGEST)
}

export function userAvatarUrl(url: string | null | undefined): string | null {
  return uploadVariantUrl(url, USER_AVATAR_VARIATION_DIGEST)
}

export function tiptapImageVariantUrls(content: unknown, variationDigest: string): unknown {
  if (!isRecord(content)) return content
  const nodes = walkNodes(content.content, (node) => {
    if (node.type !== "image") return node
    const src = typeof node.attrs?.src === "string" ? node.attrs.src : null
    const nextSrc = uploadVariantUrl(src, variationDigest)
    if (!nextSrc || nextSrc === src) return node
    return { ...node, attrs: { ...node.attrs, src: nextSrc } }
  })
  if (!nodes.changed) return content
  return { ...content, content: nodes.content }
}

export function postFormatDataVariantUrls<T>(formatData: T, variationDigest: string): T {
  if (!isRecord(formatData)) return formatData

  let changed = false
  const nextFormatData: Record<string, unknown> = { ...formatData }
  for (const key of ["image_url", "thumbnail_url"] as const) {
    const url = typeof formatData[key] === "string" ? formatData[key] : null
    const nextUrl = uploadVariantUrl(url, variationDigest)
    if (!nextUrl || nextUrl === url) continue
    nextFormatData[key] = nextUrl
    changed = true
  }

  return (changed ? nextFormatData : formatData) as T
}

export function normalizePrivateUploadUrl(url: string): string {
  const parsed = parsePrivateUploadUrl(url)
  if (!parsed) return url
  return `${parsed.path}${parsed.suffix}`
}

export function normalizePrivateUploadUrlsInString(value: string): string {
  return value
    .replace(ABSOLUTE_APP_UPLOAD_URL_PATTERN, (_match, path: string) => path)
    .replace(ABSOLUTE_RAILS_ACTIVE_STORAGE_BLOB_URL_PATTERN, (match: string) => normalizePrivateUploadUrl(match))
    .replace(RELATIVE_RAILS_ACTIVE_STORAGE_BLOB_URL_PATTERN, (_match, prefix: string, url: string) => {
      return `${prefix}${normalizePrivateUploadUrl(url)}`
    })
}

export function normalizePrivateUploadUrls(value: Prisma.JsonValue): { value: Prisma.JsonValue; changed: boolean }
export function normalizePrivateUploadUrls(value: unknown): { value: unknown; changed: boolean }
export function normalizePrivateUploadUrls(value: unknown): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    const exactUrl = normalizePrivateUploadUrl(value)
    const normalized = exactUrl !== value ? exactUrl : normalizePrivateUploadUrlsInString(value)
    return { value: normalized, changed: normalized !== value }
  }

  if (Array.isArray(value)) {
    let changed = false
    const normalized = value.map((child) => {
      const result = normalizePrivateUploadUrls(child)
      if (result.changed) changed = true
      return result.value
    })
    return changed ? { value: normalized, changed: true } : { value, changed: false }
  }

  if (!isRecord(value)) return { value, changed: false }

  let changed = false
  const normalized: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const result = normalizePrivateUploadUrls(child)
    normalized[key] = result.value
    if (result.changed) changed = true
  }

  return changed ? { value: normalized, changed: true } : { value, changed: false }
}

export function extractPrivateUploadBlobIds(value: unknown): number[] {
  const ids = new Set<number>()
  walkJson(value, (node) => {
    if (typeof node !== "string") return
    const normalized = normalizePrivateUploadUrlsInString(node)
    for (const match of normalized.matchAll(RELATIVE_APP_UPLOAD_URL_PATTERN)) {
      const id = Number(match[4])
      if (id > 0) ids.add(id)
    }
  })
  return [...ids]
}

export function findUnsupportedMediaSrcs(value: unknown): string[] {
  const srcs = new Set<string>()
  walkJson(value, (node) => {
    if (!isRecord(node)) return
    if (node.type !== "image" && node.type !== "video") return
    const attrs = isRecord(node.attrs) ? node.attrs : null
    const candidates = [attrs?.src, attrs?.playbackUrl]
    for (const candidate of candidates) {
      const src = typeof candidate === "string" ? candidate : null
      if (!src || !isUnsupportedMediaSrc(src)) continue
      srcs.add(src)
    }
  })
  return [...srcs]
}

export const findUnsupportedImageSrcs = findUnsupportedMediaSrcs

function parsePrivateUploadUrl(rawUrl: string): { basePath: string; path: string; suffix: string } | null {
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  const isAbsolute = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)
  if (
    !isAbsolute &&
    !trimmed.startsWith("/api/v1/uploads/") &&
    !trimmed.startsWith("/rails/active_storage/blobs/")
  ) {
    return null
  }

  let url: URL
  try {
    url = new URL(trimmed, "https://afire.app")
  } catch {
    return null
  }

  if (isAbsolute && !APP_UPLOAD_HOSTS.has(url.hostname.toLowerCase())) return null

  const railsBlobId = parseRailsBlobId(url.pathname)
  if (railsBlobId) {
    const path = `/api/v1/uploads/${railsBlobId}`
    return { basePath: path, path, suffix: `${url.search}${url.hash}` }
  }

  if (!APP_UPLOAD_PATH_PATTERN.test(url.pathname)) return null

  const basePath = url.pathname.replace(/\/variants\/[^/?#]+$/, "")
  return { basePath, path: url.pathname, suffix: `${url.search}${url.hash}` }
}

function parseRailsBlobId(pathname: string): number | null {
  const match = RAILS_ACTIVE_STORAGE_BLOB_PATH_PATTERN.exec(pathname)
  if (!match) return null

  const verifierPayload = decodeURIComponent(match[1]).split("--")[0]
  if (!verifierPayload) return null

  try {
    const base64 = verifierPayload.replace(/-/g, "+").replace(/_/g, "/")
    const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")
    const decoded = JSON.parse(Buffer.from(paddedBase64, "base64").toString("utf8")) as {
      _rails?: { data?: unknown; pur?: unknown }
    }
    const id = Number(decoded._rails?.data)
    if (!Number.isInteger(id) || id <= 0) return null
    return id
  } catch {
    return null
  }
}

function isUnsupportedMediaSrc(src: string): boolean {
  const normalized = src.trim().toLowerCase()
  return (
    normalized.startsWith("blob:") ||
    normalized.startsWith("data:") ||
    normalized.startsWith("file:") ||
    normalized.startsWith("filesystem:")
  )
}

function walkNodes(content: unknown, visitor: (node: TipTapNode) => TipTapNode): { content: unknown; changed: boolean } {
  if (!Array.isArray(content)) return { content, changed: false }

  let changed = false
  const nextContent = content.map((raw) => {
    if (!isRecord(raw)) return raw
    const visited = visitor(raw as TipTapNode)
    if (visited !== raw) changed = true
    const childResult = walkNodes(visited.content, visitor)
    if (!childResult.changed) return visited
    changed = true
    return { ...visited, content: childResult.content }
  })

  return { content: nextContent, changed }
}

function isRecord(value: unknown): value is TipTapDoc {
  return typeof value === "object" && value !== null
}

function walkJson(value: unknown, visit: (value: unknown) => void) {
  visit(value)
  if (Array.isArray(value)) {
    for (const child of value) {
      walkJson(child, visit)
    }
    return
  }
  if (!isRecord(value)) return
  for (const child of Object.values(value)) {
    walkJson(child, visit)
  }
}
