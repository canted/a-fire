import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import { PrismaService } from "../prisma/prisma.service"
import { ImagesModule } from "../uploads/images/images.module"
import { ImageVariantsService } from "../uploads/images/image-variants.service"
import { loadEnv } from "../runtime/loadEnv"
import { ensureDatabaseUrl } from "../runtime/env"

async function main() {
  loadEnv(); ensureDatabaseUrl()
  const apply = process.argv.includes("--apply")
  if (process.argv.slice(2).some(arg => arg !== "--apply")) throw new Error("Usage: backfill-image-metadata [--apply]")
  const app = await NestFactory.createApplicationContext(ImagesModule, { logger: ["error", "warn"] })
  const prisma = app.get(PrismaService), images = app.get(ImageVariantsService)
  let cursor = 0, pending = 0, repaired = 0, failed = 0
  try {
    for (;;) {
      const rows = await prisma.activeStorageBlob.findMany({ where: { id: { gt: cursor }, content_type: { startsWith: "image/" } }, orderBy: { id: "asc" }, take: 100, select: { id: true, metadata: true } })
      if (!rows.length) break
      for (const row of rows) {
        cursor = row.id
        try { if (JSON.parse(row.metadata ?? "{}").contentType) continue } catch { /* Repair invalid JSON too. */ }
        pending++
        if (!apply) continue
        try { await images.repairMetadata(row.id); repaired++ } catch (error) {
          failed++
          console.error(JSON.stringify({ event: "image_metadata_repair_failed", blob_id: row.id, message: error instanceof Error ? error.message : String(error) }))
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: "image_metadata_backfill", mode: apply ? "apply" : "dry_run", pending, repaired, failed }))
    if (failed) process.exitCode = 1
  } finally { await app.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
