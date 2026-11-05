import type { Prisma } from "@prisma/client"
import { BadRequestException, Inject, Injectable } from "@nestjs/common"
import { isIP } from "node:net"
import { lookup } from "node:dns/promises"
import { PrismaService } from "../../../prisma/prisma.service"
import { firstExternalLinkFromContent, normalizedHttpUrl } from "./link-preview-content"
import type { LinkPreviewAttachmentInput, LinkPreviewAttachmentPayload, LinkPreviewPayload } from "./link-preview.types"

export type PreparedLinkPreviewAttachment = { source_url: string; preview_id: number | null; hidden: boolean } | null

const MAX_REDIRECTS = 5
const FETCH_TIMEOUT_MS = 6000
const MAX_HTML_BYTES = 512 * 1024
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const FAILED_CACHE_TTL_MS = 5 * 60 * 1000

type LinkPreviewRow = {
  id: number
  url: string
  canonical_url?: string | null
  title?: string | null
  description?: string | null
  site_name?: string | null
  image_url?: string | null
  favicon_url?: string | null
  accent_color?: string | null
  status: string
  error_code?: string | null
  fetched_at?: Date | null
}

type LinkPreviewAttachmentRow = {
  id: number
  owner_type: string
  owner_id: number
  source_url?: string | null
  hidden: boolean
  preview?: LinkPreviewRow | null
}

type PreviewMetadata = {
  canonicalUrl?: string | null
  title?: string | null
  description?: string | null
  siteName?: string | null
  imageUrl?: string | null
  faviconUrl?: string | null
  accentColor?: string | null
  finalUrl: string
}

@Injectable()
export class LinkPreviewsService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  async resolve(urlInput: unknown): Promise<LinkPreviewPayload> {
    const url = normalizedHttpUrl(urlInput)
    if (!url) throw new BadRequestException("A valid http or https URL is required")

    const existing = await this.prisma.linkPreview.findUnique({ where: { url } })
    if (existing && !this.isStale(existing)) {
      return this.serializePreview(existing)
    }

    const now = new Date()
    try {
      const metadata = await this.fetchPreviewMetadata(url)
      const payload = {
        canonical_url: metadata.canonicalUrl ?? metadata.finalUrl,
        title: metadata.title,
        description: metadata.description,
        site_name: metadata.siteName,
        image_url: metadata.imageUrl,
        favicon_url: metadata.faviconUrl,
        accent_color: metadata.accentColor ?? accentColorForUrl(metadata.finalUrl),
        status: "ready",
        error_code: null,
        fetched_at: now,
        updated_at: now,
      }

      const row = existing
        ? await this.prisma.linkPreview.update({ where: { id: existing.id }, data: payload })
        : await this.prisma.linkPreview.create({
            data: {
              url,
              ...payload,
              created_at: now,
            },
          })

      return this.serializePreview(row)
    } catch (error) {
      const errorCode = error instanceof LinkPreviewFetchError ? error.code : "fetch_failed"
      const fallback = {
        canonical_url: url,
        title: hostnameForUrl(url),
        description: null,
        site_name: hostnameForUrl(url),
        image_url: null,
        favicon_url: null,
        accent_color: accentColorForUrl(url),
        status: "failed",
        error_code: errorCode,
        fetched_at: now,
        updated_at: now,
      }
      const row = existing
        ? await this.prisma.linkPreview.update({ where: { id: existing.id }, data: fallback })
        : await this.prisma.linkPreview.create({ data: { url, ...fallback, created_at: now } })
      return this.serializePreview(row)
    }
  }

  async upsertAttachment(
    ownerType: "Post" | "Reply",
    ownerId: number,
    input: unknown,
    content: unknown,
  ): Promise<LinkPreviewAttachmentPayload | null> {
    return this.applyPreparedAttachment(ownerType, ownerId, await this.prepareAttachment(input, content))
  }

  /** Resolve external metadata before entering a business transaction. */
  async prepareAttachment(input: unknown, content: unknown): Promise<PreparedLinkPreviewAttachment> {
    const attachmentInput = inputObject(input)
    const sourceUrl = normalizedHttpUrl(attachmentInput?.source_url ?? attachmentInput?.sourceUrl) ?? firstExternalLinkFromContent(content)
    if (!sourceUrl) return null
    if (attachmentInput?.hidden) return { source_url: sourceUrl, preview_id: null, hidden: true }
    const preview = await this.resolve(sourceUrl)
    return { source_url: sourceUrl, preview_id: preview.id, hidden: false }
  }

  async applyPreparedAttachment(
    ownerType: "Post" | "Reply", ownerId: number, prepared: PreparedLinkPreviewAttachment,
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<LinkPreviewAttachmentPayload | null> {
    if (!prepared) {
      await database.linkPreviewAttachment.deleteMany({ where: { owner_type: ownerType, owner_id: ownerId } })
      return null
    }
    const row = await this.writeAttachment(ownerType, ownerId, prepared, database)
    return this.serializeAttachmentRow(row, { includeHidden: true })
  }

  async serializeAttachment(
    ownerType: "Post" | "Reply",
    ownerId: number,
    options: { includeHidden?: boolean } = {},
  ): Promise<LinkPreviewAttachmentPayload | null> {
    const row = await this.prisma.linkPreviewAttachment.findFirst({
      where: { owner_type: ownerType, owner_id: ownerId },
      include: { preview: true },
    })
    return this.serializeAttachmentRow(row, options)
  }

  async attachmentsForOwners(
    ownerType: "Post" | "Reply",
    ownerIds: number[],
    options: { includeHidden?: boolean } = {},
  ): Promise<Map<number, LinkPreviewAttachmentPayload>> {
    if (ownerIds.length === 0) return new Map()
    const rows = await this.prisma.linkPreviewAttachment.findMany({
      where: { owner_type: ownerType, owner_id: { in: ownerIds } },
      include: { preview: true },
    })
    const map = new Map<number, LinkPreviewAttachmentPayload>()
    rows.forEach((row: LinkPreviewAttachmentRow) => {
      const payload = this.serializeAttachmentRow(row, options)
      if (payload) map.set(row.owner_id, payload)
    })
    return map
  }

  private async writeAttachment(
    ownerType: "Post" | "Reply",
    ownerId: number,
    data: { source_url: string; preview_id: number | null; hidden: boolean },
    database: Prisma.TransactionClient = this.prisma,
  ) {
    const existing = await database.linkPreviewAttachment.findFirst({
      where: { owner_type: ownerType, owner_id: ownerId },
    })
    const timestamp = new Date()
    if (existing) {
      return database.linkPreviewAttachment.update({
        where: { id: existing.id },
        data: { ...data, updated_at: timestamp },
        include: { preview: true },
      })
    }

    return database.linkPreviewAttachment.create({
      data: {
        owner_type: ownerType,
        owner_id: ownerId,
        ...data,
        created_at: timestamp,
        updated_at: timestamp,
      },
      include: { preview: true },
    })
  }

  private serializeAttachmentRow(
    row?: LinkPreviewAttachmentRow | null,
    options: { includeHidden?: boolean } = {},
  ): LinkPreviewAttachmentPayload | null {
    if (!row) return null
    if (row.hidden && !options.includeHidden) return null
    const preview = row.preview ? this.serializePreview(row.preview) : null
    if (!row.hidden && (!preview || preview.status !== "ready")) return null
    return {
      source_url: row.source_url ?? null,
      hidden: row.hidden,
      preview,
    }
  }

  private serializePreview(row: LinkPreviewRow): LinkPreviewPayload {
    return {
      id: Number(row.id),
      url: row.url,
      canonical_url: row.canonical_url ?? null,
      title: row.title ?? null,
      description: row.description ?? null,
      site_name: row.site_name ?? null,
      image_url: row.image_url ?? null,
      favicon_url: row.favicon_url ?? null,
      accent_color: row.accent_color ?? accentColorForUrl(row.canonical_url ?? row.url),
      status: row.status === "ready" ? "ready" : "failed",
      error_code: row.error_code ?? null,
    }
  }

  private isStale(preview: Pick<LinkPreviewRow, "status" | "fetched_at">) {
    if (!preview.fetched_at) return true
    const ttl = preview.status === "ready" ? CACHE_TTL_MS : FAILED_CACHE_TTL_MS
    return Date.now() - preview.fetched_at.getTime() > ttl
  }

  private async fetchPreviewMetadata(url: string): Promise<PreviewMetadata> {
    const youtubeVideoId = youtubeVideoIdFromUrl(url)
    if (youtubeVideoId) {
      try {
        return await fetchYouTubeMetadata(url, youtubeVideoId)
      } catch {
        // Fall through to the ordinary page metadata fetch when oEmbed is unavailable.
      }
    }

    let currentUrl = url
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      await assertSafeDestination(currentUrl)
      const response = await fetch(currentUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "A Fire link preview bot",
        },
      })

      if (isRedirect(response.status)) {
        const location = response.headers.get("location")
        if (!location) throw new LinkPreviewFetchError("redirect_without_location")
        currentUrl = normalizedHttpUrl(new URL(location, currentUrl).toString()) ?? ""
        if (!currentUrl) throw new LinkPreviewFetchError("invalid_redirect")
        continue
      }

      if (!response.ok) throw new LinkPreviewFetchError("bad_status")
      const contentType = response.headers.get("content-type") ?? ""
      if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        throw new LinkPreviewFetchError("unsupported_content_type")
      }

      const html = await readLimitedText(response)
      return metadataFromHtml(html, currentUrl)
    }

    throw new LinkPreviewFetchError("too_many_redirects")
  }
}

async function fetchYouTubeMetadata(url: string, videoId: string): Promise<PreviewMetadata> {
  const endpoint = new URL("https://www.youtube.com/oembed")
  endpoint.searchParams.set("url", url)
  endpoint.searchParams.set("format", "json")
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      accept: "application/json",
      "user-agent": "A Fire link preview bot",
    },
  })
  if (!response.ok) throw new LinkPreviewFetchError("youtube_oembed_failed")
  const contentLength = Number(response.headers.get("content-length") ?? 0)
  if (contentLength > MAX_HTML_BYTES) throw new LinkPreviewFetchError("response_too_large")
  const payload = await response.json() as {
    title?: unknown
    author_name?: unknown
    thumbnail_url?: unknown
  }

  return {
    finalUrl: url,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    title: stringValue(payload.title),
    description: null,
    siteName: "YouTube",
    imageUrl:
      absoluteOptionalUrl(stringValue(payload.thumbnail_url), url) ??
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    faviconUrl: "https://www.youtube.com/s/desktop/f506bd45/img/favicon_144x144.png",
    accentColor: "#ff0000",
  }
}

export function youtubeVideoIdFromUrl(input: string): string | null {
  try {
    const url = new URL(input)
    const host = url.hostname.toLowerCase().replace(/^www\./, "")
    let candidate: string | null = null
    if (host === "youtu.be") candidate = url.pathname.split("/").filter(Boolean)[0] ?? null
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (url.pathname === "/watch") candidate = url.searchParams.get("v")
      if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/")) {
        candidate = url.pathname.split("/").filter(Boolean)[1] ?? null
      }
    }
    return candidate && /^[A-Za-z0-9_-]{6,20}$/.test(candidate) ? candidate : null
  } catch {
    return null
  }
}

export function metadataFromHtml(html: string, finalUrl: string): PreviewMetadata {
  const title = firstText([
    metaContent(html, "property", "og:title"),
    metaContent(html, "name", "twitter:title"),
    titleText(html),
  ])
  const description = firstText([
    metaContent(html, "property", "og:description"),
    metaContent(html, "name", "twitter:description"),
    metaContent(html, "name", "description"),
  ])
  const siteName = firstText([metaContent(html, "property", "og:site_name"), hostnameForUrl(finalUrl)])
  const canonicalUrl = absoluteOptionalUrl(
    firstText([metaContent(html, "property", "og:url"), linkHref(html, "canonical")]),
    finalUrl,
  )
  const imageUrl = absoluteOptionalUrl(
    firstText([metaContent(html, "property", "og:image"), metaContent(html, "name", "twitter:image")]),
    finalUrl,
  )
  const faviconUrl = absoluteOptionalUrl(
    firstText([
      linkHref(html, "icon"),
      linkHref(html, "shortcut icon"),
      linkHref(html, "apple-touch-icon"),
      "/favicon.ico",
    ]),
    finalUrl,
  )
  const accentColor = normalizedColor(metaContent(html, "name", "theme-color"))

  return {
    finalUrl,
    canonicalUrl,
    title,
    description,
    siteName,
    imageUrl,
    faviconUrl,
    accentColor,
  }
}

export async function assertSafeDestination(urlInput: string): Promise<void> {
  const normalized = normalizedHttpUrl(urlInput)
  if (!normalized) throw new LinkPreviewFetchError("invalid_url")
  const url = new URL(normalized)
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".localhost")) throw new LinkPreviewFetchError("blocked_host")

  const literalIp = isIP(host)
  if (literalIp && isPrivateAddress(host)) throw new LinkPreviewFetchError("blocked_host")
  if (literalIp) return

  const addresses = await lookup(host, { all: true, verbatim: true })
  if (addresses.length === 0) throw new LinkPreviewFetchError("dns_failed")
  if (addresses.some((address) => isPrivateAddress(address.address))) {
    throw new LinkPreviewFetchError("blocked_host")
  }
}

export class LinkPreviewFetchError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

function inputObject(input: unknown): LinkPreviewAttachmentInput | null {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as LinkPreviewAttachmentInput) : null
}

function isRedirect(status: number) {
  return status >= 300 && status < 400
}

async function readLimitedText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") ?? 0)
  if (contentLength > MAX_HTML_BYTES) throw new LinkPreviewFetchError("response_too_large")
  if (!response.body) return response.text()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_HTML_BYTES) {
      reader.cancel().catch(() => undefined)
      throw new LinkPreviewFetchError("response_too_large")
    }
    chunks.push(value)
  }

  return new TextDecoder("utf-8").decode(concatUint8Arrays(chunks, size))
}

function concatUint8Arrays(chunks: Uint8Array[], size: number) {
  const output = new Uint8Array(size)
  let offset = 0
  chunks.forEach((chunk) => {
    output.set(chunk, offset)
    offset += chunk.byteLength
  })
  return output
}

function metaContent(html: string, attr: "name" | "property", value: string): string | null {
  const tag = findTag(html, "meta", attr, value)
  if (!tag) return null
  return htmlEntityDecode(attributeValue(tag, "content"))
}

function linkHref(html: string, rel: string): string | null {
  const tag = findTag(html, "link", "rel", rel)
  if (!tag) return null
  return htmlEntityDecode(attributeValue(tag, "href"))
}

function findTag(html: string, tagName: "meta" | "link", attr: string, value: string): string | null {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi")
  const expected = value.toLowerCase()
  for (const match of html.matchAll(pattern)) {
    const tag = match[0]
    const actual = attributeValue(tag, attr)?.toLowerCase()
    if (!actual) continue
    const relParts = attr === "rel" ? actual.split(/\s+/) : [actual]
    if (relParts.includes(expected)) return tag
  }
  return null
}

function attributeValue(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")
  const match = tag.match(pattern)
  return match?.[2] ?? match?.[3] ?? match?.[4] ?? null
}

function titleText(html: string): string | null {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  return htmlEntityDecode(match?.[1])
}

function htmlEntityDecode(value?: string | null): string | null {
  if (!value) return null
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim() || null
}

function firstText(values: Array<string | null | undefined>): string | null {
  return values.find((value): value is string => Boolean(value?.trim()))?.trim() ?? null
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function absoluteOptionalUrl(input: string | null | undefined, base: string): string | null {
  if (!input) return null
  try {
    return normalizedHttpUrl(new URL(input, base).toString())
  } catch {
    return null
  }
}

function normalizedColor(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(trimmed)) return trimmed
  return null
}

function hostnameForUrl(input: string): string {
  try {
    return new URL(input).hostname.replace(/^www\./, "")
  } catch {
    return "Link"
  }
}

function accentColorForUrl(input: string): string {
  const host = hostnameForUrl(input)
  let hash = 0
  for (let index = 0; index < host.length; index += 1) {
    hash = (hash * 31 + host.charCodeAt(index)) % 360
  }
  return `hsl(${hash} 58% 42%)`
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) {
    const parts = address.split(".").map(Number)
    const [a, b] = parts
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  if (version === 6) {
    // URL canonicalization also converts dotted IPv4 tails and expanded IPv6 forms.
    const lower = new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase()
    const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(lower)
    if (mapped) {
      const high = Number.parseInt(mapped[1], 16)
      const low = Number.parseInt(mapped[2], 16)
      return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
    }
    return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || /^fe[89ab]/.test(lower)
  }
  return true
}
