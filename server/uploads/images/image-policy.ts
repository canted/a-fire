import { BadRequestException } from "@nestjs/common"
import { memoryStorage } from "multer"
import sharp from "sharp"
import { IMAGE_MAX_DIMENSION, IMAGE_MAX_FRAMES, IMAGE_MAX_PIXELS, IMAGE_UPLOAD_MAX_BYTES } from "../../../types/image-policy"
import { withImageProcessing } from "./image-processing"

// Keep libvips caches and CPU concurrency within the small worker memory budget.
sharp.cache({ memory: 8, files: 0, items: 32 })
sharp.concurrency(1)

export { IMAGE_UPLOAD_MAX_BYTES }
export const IMAGE_MULTIPART_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: IMAGE_UPLOAD_MAX_BYTES, files: 2, fields: 40, parts: 42 },
}
const CONTENT_TYPES: Record<string, string> = {
  jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif",
}

export async function inspectImage(buffer: Buffer) {
  if (buffer.length > IMAGE_UPLOAD_MAX_BYTES) throw new BadRequestException("Images must be 20 MB or smaller.")
  const pipeline = sharp(buffer, { animated: true, limitInputPixels: IMAGE_MAX_PIXELS, failOn: "warning" })
    .timeout({ seconds: 10 })
  const metadata = await pipeline.metadata()
  const format = metadata.format === "heif" && metadata.compression === "av1" ? "avif" : metadata.format ?? ""
  const contentType = CONTENT_TYPES[format]
  if (!contentType) throw new BadRequestException("Unsupported image format. Use JPEG, PNG, WebP, GIF, or AVIF.")
  const frames = metadata.pages ?? 1
  const inputWidth = metadata.width ?? 0
  const inputHeight = metadata.pageHeight ?? metadata.height ?? 0
  if (!inputWidth || !inputHeight || inputWidth > IMAGE_MAX_DIMENSION || inputHeight > IMAGE_MAX_DIMENSION ||
      frames > IMAGE_MAX_FRAMES || inputWidth * inputHeight * frames > IMAGE_MAX_PIXELS) {
    throw new BadRequestException("Image dimensions are too large (8192px per side, 25 megapixels across at most 100 frames).")
  }
  const swap = (metadata.orientation ?? 1) >= 5
  return {
    pipeline,
    contentType,
    width: swap ? inputHeight : inputWidth,
    height: swap ? inputWidth : inputHeight,
    frames,
  }
}

export async function validateImageUpload(file: { buffer: Buffer; size: number; mimetype?: string }) {
  if (file.size > IMAGE_UPLOAD_MAX_BYTES || file.buffer.length > IMAGE_UPLOAD_MAX_BYTES) {
    throw new BadRequestException("Images must be 20 MB or smaller.")
  }
  return withImageProcessing(async () => {
    try {
      const { pipeline, ...metadata } = await inspectImage(file.buffer)
      // Decode the pixels too: a readable header alone does not establish a valid image.
      await pipeline.rotate().resize({ width: 1, height: 1, fit: "inside" }).webp().toBuffer()
      return metadata
    } catch (error) {
      if (error instanceof BadRequestException) throw error
      throw new BadRequestException("This image could not be decoded or exceeds the image limits.")
    }
  })
}
