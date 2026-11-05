/** Browser/server image contract. Keep this module free of platform dependencies. */
export const IMAGE_TRANSFORM_VERSION = 2
export const IMAGE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024
export const IMAGE_MAX_PIXELS = 25_000_000
export const IMAGE_MAX_DIMENSION = 8192
export const IMAGE_MAX_FRAMES = 100
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/avif"
export const IMAGE_VARIANT_WIDTHS = {
  w1200: 1200,
  w600: 600,
  w320: 320,
  icon96: 96,
  icon160: 160,
  avatarStripe40: 40,
} as const
export type ImageVariant = keyof typeof IMAGE_VARIANT_WIDTHS
export type ImagePurpose = "content" | "thumbnail" | "icon" | "avatar"
export const IMAGE_PURPOSE_VARIANTS: Record<ImagePurpose, readonly ImageVariant[]> = {
  content: ["w320", "w600", "w1200"],
  thumbnail: ["w320", "w600"],
  icon: ["icon96", "icon160"],
  avatar: ["avatarStripe40", "icon96", "icon160"],
}
