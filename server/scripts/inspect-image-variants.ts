import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import { ImagesModule } from "../uploads/images/images.module"
import { ImageVariantsService } from "../uploads/images/image-variants.service"
import { parseImageVariantInventoryArgs } from "../runtime/repairImageVariants"
import { loadEnv } from "../runtime/loadEnv"
import { ensureDatabaseUrl } from "../runtime/env"

async function bootstrap() {
  const options = parseImageVariantInventoryArgs(process.argv.slice(2))
  loadEnv()
  ensureDatabaseUrl()
  const app = await NestFactory.createApplicationContext(ImagesModule, { logger: ["error", "warn"] })
  try {
    const page = await app.get(ImageVariantsService).previewRepairPage(options.afterId, options.limit, options.digests)
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: "image_variant_inventory", requested_variants: options.digests, ...page }))
  } finally { await app.close() }
}
bootstrap().catch(error => { console.error(error); process.exitCode = 1 })
