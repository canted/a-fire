import type { PrismaService } from "../prisma/prisma.service"
export function parseRecoverPendingMediaArgs(args: string[]) {
  let kind: "audio" | "video" | undefined, assetId: number | undefined, before: Date | undefined
  let execute = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === "--execute") { execute = true; continue }
    const value = args[++index]
    if (!value) throw new Error(`${arg} requires a value`)
    if (arg === "--kind" && (value === "audio" || value === "video")) kind = value
    else if (arg === "--asset-id") assetId = Number(value)
    else if (arg === "--before") before = new Date(value)
    else throw new Error(`Invalid argument: ${arg}`)
  }
  if (!kind || !assetId || !Number.isSafeInteger(assetId) || assetId < 1 || !before || !Number.isFinite(before.getTime())) throw new Error("Require --kind audio|video, positive --asset-id and valid --before")
  return { kind, assetId, before, execute }
}
export async function previewPendingMediaRecovery(prisma: PrismaService, kind: "audio" | "video", id: number) {
  const query = { where: { id }, select: { id: true, blob_id: true, processing_status: true, updated_at: true } }
  return kind === "audio" ? prisma.audioAsset.findUnique(query) : prisma.videoAsset.findUnique(query)
}
