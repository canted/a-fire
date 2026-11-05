import { IMAGE_VARIANT_WIDTHS, IMAGE_TRANSFORM_VERSION, type ImageVariant } from "../../../types/image-policy"
import { inspectImage } from "./image-policy"
import { withImageProcessing } from "./image-processing"

const VARIANT_WIDTHS = new Map<string, number>(Object.entries(IMAGE_VARIANT_WIDTHS))

export const IMAGE_VARIATION_DIGESTS = [...VARIANT_WIDTHS.keys()]

export function imageVariantWidth(variationDigest: string): number | null {
  return VARIANT_WIDTHS.get(variationDigest) ?? null
}

export function isImageVariationDigest(variationDigest: string): boolean {
  return VARIANT_WIDTHS.has(variationDigest)
}

export async function createImageVariant(sourceBuffer: Buffer, variationDigest: string): Promise<Buffer> {
  const width = imageVariantWidth(variationDigest)
  if (!width) throw new Error(`Unknown image variation digest: ${variationDigest}`)

  return withImageProcessing(async () => {
    const { pipeline } = await inspectImage(sourceBuffer)
    return pipeline.rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 80, effort: 4 }).toBuffer()
  })
}

export function imageVariantKey(blobKey: string, digest: string) {
  if (!isImageVariationDigest(digest)) throw new Error(`Unknown image variation digest: ${digest}`)
  return `variants/${blobKey}/v${IMAGE_TRANSFORM_VERSION}/${digest}.webp`
}

export function imageVariantsForAttachment(target: { record_type?: string; name?: string }): ImageVariant[] {
  if (target.name === "banner") return ["w320", "w600", "w1200"]
  if (["User", "CircleMembership", "CommunityMembership"].includes(target.record_type ?? "")) return ["avatarStripe40", "icon96", "icon160"]
  if (target.name === "icon" || ["Circle", "Community", "Board"].includes(target.record_type ?? "")) return ["icon96", "icon160"]
  return ["w320", "w600", "w1200"]
}
