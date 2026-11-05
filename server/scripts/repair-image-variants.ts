import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import { ImagesModule } from "../uploads/images/images.module"
import { ImageVariantsService } from "../uploads/images/image-variants.service"
import { parseRepairImageVariantArgs } from "../runtime/repairImageVariants"
import { loadEnv } from "../runtime/loadEnv"
import { ensureDatabaseUrl } from "../runtime/env"

async function bootstrap() {
  const options = parseRepairImageVariantArgs(process.argv.slice(2))
  loadEnv()
  ensureDatabaseUrl()
  const app = await NestFactory.createApplicationContext(ImagesModule, { logger: ["error", "warn"] })
  try {
    const images = app.get(ImageVariantsService)
    const before = await images.previewRepair(options.blobId, options.digests)
    if (options.execute) await images.ensure(options.blobId, options.digests)
    const after = options.execute ? await images.previewRepair(options.blobId, options.digests) : null
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: "image_variant_repair", dry_run: !options.execute, before, after }))
  } finally { await app.close() }
}
bootstrap().catch(error => { console.error(error); process.exitCode = 1 })
