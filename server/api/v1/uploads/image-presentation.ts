import type { PrismaClient } from "@prisma/client"
import { extractPrivateUploadBlobIds, tiptapImageVariantUrls } from "./upload-urls"
import { IMAGE_MAX_DIMENSION } from "../../../../types/image-policy"

function dimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= IMAGE_MAX_DIMENSION
}

/** Only decoded server metadata establishes oriented intrinsic dimensions. */
export function imageDimensionsFromMetadata(raw: string | null | undefined): { width: number; height: number } | null {
  try {
    const metadata = JSON.parse(raw ?? "{}")
    // Legacy metadata could contain client-supplied or unrotated dimensions.
    if (metadata.contentType && dimension(metadata.width) && dimension(metadata.height)) return { width: metadata.width, height: metadata.height }
  } catch { /* An old malformed metadata value must not break its presentation. */ }
  return null
}

/** Batch metadata lookup for already-authorized documents; never writes editor content. */
export async function presentImageDocuments(prisma: Pick<PrismaClient, "activeStorageBlob">, documents: unknown[], variant = "w1200"): Promise<unknown[]> {
  const ids = new Set<number>()
  const visit = (value: unknown, callback: (node: Record<string, any>) => unknown): unknown => {
    if (Array.isArray(value)) return value.map(child => visit(child, callback))
    if (!value || typeof value !== "object") return value
    const node = value as Record<string, any>
    const next = node.content ? { ...node, content: visit(node.content, callback) } : node
    return node.type === "image" ? callback(next) : next
  }
  documents.forEach(doc => visit(doc, node => {
    if (!dimension(node.attrs?.width) || !dimension(node.attrs?.height)) {
      extractPrivateUploadBlobIds(node.attrs?.src).forEach(id => ids.add(id))
    }
    return node
  }))
  const blobs = ids.size ? await prisma.activeStorageBlob.findMany({ where: { id: { in: [...ids] } }, select: { id: true, metadata: true } }) : []
  const dimensions = new Map<number, { width: number; height: number }>()
  for (const blob of blobs) {
    const size = imageDimensionsFromMetadata(blob.metadata)
    if (size) dimensions.set(blob.id, size)
  }
  return documents.map(doc => tiptapImageVariantUrls(visit(doc, node => {
    if (dimension(node.attrs?.width) && dimension(node.attrs?.height)) return node
    const size = dimensions.get(extractPrivateUploadBlobIds(node.attrs?.src)[0])
    return size ? { ...node, attrs: { ...node.attrs, ...size } } : node
  }), variant))
}
