import { Inject, Injectable, NotFoundException } from "@nestjs/common"
import { ImageVariantsService } from "./image-variants.service"

@Injectable()
export class ImageVariantProcessor {
  @Inject(ImageVariantsService) private readonly images!: ImageVariantsService

  async process(payload: { blobId: number; variationDigest?: string; variationDigests?: string[]; entryId?: number; originalUrl?: string; variantUrl?: string }): Promise<void> {
    try {
      await this.images.ensure(payload.blobId, payload.variationDigests ?? (payload.variationDigest ? [payload.variationDigest] : []))
    } catch (error) {
      // Deleting an upload while its job is queued is an expected lifecycle event.
      if (!(error instanceof NotFoundException)) throw error
    }
    // Images are selected at presentation time. Workers must never rewrite documents.
  }
}
