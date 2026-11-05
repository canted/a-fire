import { IMAGE_PURPOSE_VARIANTS, IMAGE_TRANSFORM_VERSION, IMAGE_VARIANT_WIDTHS, type ImagePurpose, type ImageVariant } from "../../../types/image-policy"

export function positiveImageDimension(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 && number <= 8192 ? number : undefined
}

function privateUploadUrl(src: string): URL | null {
  try {
    const origin = typeof window === "undefined" ? "https://afire.app" : window.location.origin
    const url = new URL(src, origin)
    const local = src.startsWith("/api/v1/uploads/") || url.origin === origin || ["afire.app", "www.afire.app", "localhost", "127.0.0.1"].includes(url.hostname)
    if (!local || !/^https?:$/.test(url.protocol) || !/^\/api\/v1\/uploads\/\d+(?:\/variants\/[^/]+)?$/.test(url.pathname)) return null
    return url
  } catch { return null }
}

export function imageVariantSource(src: string, variant: ImageVariant): string {
  const url = privateUploadUrl(src)
  if (!url) return src
  url.pathname = `${url.pathname.replace(/\/variants\/[^/]+$/, "")}/variants/${variant}`
  url.searchParams.set("imageVersion", String(IMAGE_TRANSFORM_VERSION))
  return `${url.pathname}${url.search}${url.hash}`
}

export function imagePresentation({ src, purpose = "content", sizes, width, height, priority = false }: {
  src: string; purpose?: ImagePurpose; sizes?: string; width?: number | string | null; height?: number | string | null; priority?: boolean;
}) {
  const sourceWidth = positiveImageDimension(width)
  const sourceHeight = positiveImageDimension(height)
  const variants = IMAGE_PURPOSE_VARIANTS[purpose]
  const candidates = new Map<number, ImageVariant>()
  for (const variant of variants) {
    const candidateWidth = sourceWidth ? Math.min(sourceWidth, IMAGE_VARIANT_WIDTHS[variant]) : IMAGE_VARIANT_WIDTHS[variant]
    if (!candidates.has(candidateWidth)) candidates.set(candidateWidth, variant)
  }
  const privateImage = privateUploadUrl(src)
  return {
    src: privateImage ? imageVariantSource(src, [...candidates.values()].at(-1)!) : src,
    srcSet: privateImage ? [...candidates].map(([pixels, variant]) => `${imageVariantSource(src, variant)} ${pixels}w`).join(", ") : undefined,
    sizes: privateImage ? sizes ?? (purpose === "avatar" || purpose === "icon" ? "48px" : "100vw") : undefined,
    width: sourceWidth,
    height: sourceHeight,
    loading: priority ? "eager" as const : "lazy" as const,
    decoding: "async" as const,
    fetchPriority: priority ? "high" as const : "low" as const,
    referrerPolicy: "no-referrer" as const,
  }
}
