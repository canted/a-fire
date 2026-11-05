export type LinkPreviewStatus = "ready" | "failed"

export type LinkPreviewPayload = {
  id: number
  url: string
  canonical_url?: string | null
  title?: string | null
  description?: string | null
  site_name?: string | null
  image_url?: string | null
  favicon_url?: string | null
  accent_color?: string | null
  status: LinkPreviewStatus
  error_code?: string | null
}

export type LinkPreviewAttachmentPayload = {
  source_url?: string | null
  hidden: boolean
  preview?: LinkPreviewPayload | null
}

export type LinkPreviewAttachmentInput = {
  source_url?: string | null
  sourceUrl?: string | null
  hidden?: boolean
}
