import { Prisma, type PrismaClient } from "@prisma/client"
import { circleIconUrl, userAvatarUrl } from "./upload-urls"

/** Resolves the latest identity attachment through the canonical avatar or circle variant policy. */
export async function identityImageUrl(
  prisma: Pick<PrismaClient, "activeStorageAttachment">,
  recordType: "Circle" | "CircleMembership" | "User",
  recordId: number,
) {
  if (!prisma.activeStorageAttachment?.findFirst) return null

  const attachment = await prisma.activeStorageAttachment.findFirst({
    where: {
      record_type: recordType,
      record_id: Number(recordId ?? 0),
      name: "avatar",
    },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
  })

  if (!attachment) return null
  const url = `/api/v1/uploads/${String(attachment.blob_id)}`
  return recordType === "Circle" ? circleIconUrl(url) : userAvatarUrl(url)
}

/** One latest attachment per requested identity, without returning historical rows. */
export async function identityImageUrls(
  database: Pick<PrismaClient, "$queryRaw">,
  recordType: "Circle" | "CircleMembership" | "User",
  recordIds: number[],
) {
  const ids = [...new Set(recordIds)]
  if (!ids.length) return new Map<number, string>()
  const rows = await database.$queryRaw<{ record_id: number; blob_id: number }[]>(Prisma.sql`
    SELECT identity.record_id, attachment.blob_id
    FROM unnest(ARRAY[${Prisma.join(ids)}]::integer[]) AS identity(record_id)
    CROSS JOIN LATERAL (
      SELECT blob_id FROM active_storage_attachments
      WHERE record_type = ${recordType} AND record_id = identity.record_id AND name = 'avatar'
      ORDER BY created_at DESC, id DESC LIMIT 1
    ) attachment
  `)
  return new Map(rows.map(row => {
    const url = `/api/v1/uploads/${row.blob_id}`
    return [row.record_id, recordType === "Circle" ? circleIconUrl(url) : userAvatarUrl(url)]
  }))
}


/** Project summaries need only the current icon and banner, including decoded dimensions. */
export async function projectIdentityImages(database: Pick<PrismaClient, "$queryRaw">, projectIds: number[]) {
  const ids = [...new Set(projectIds)]
  if (!ids.length) return []
  return database.$queryRaw<Array<{record_id:number; name:string; blob_id:number; active_storage_blobs:{metadata:string|null}}>>(Prisma.sql`
    SELECT identity.record_id, names.name, attachment.blob_id,
      jsonb_build_object('metadata', blob.metadata) AS active_storage_blobs
    FROM unnest(ARRAY[${Prisma.join(ids)}]::integer[]) AS identity(record_id)
    CROSS JOIN (VALUES ('icon'), ('banner')) AS names(name)
    CROSS JOIN LATERAL (
      SELECT blob_id FROM active_storage_attachments
      WHERE record_type='Project' AND record_id=identity.record_id AND name=names.name
      ORDER BY created_at DESC,id DESC LIMIT 1
    ) attachment
    -- Preserve the selected attachment as the lookup driver under generic plans.
    CROSS JOIN LATERAL (
      SELECT metadata FROM active_storage_blobs WHERE id=attachment.blob_id OFFSET 0
    ) blob
  `)
}
