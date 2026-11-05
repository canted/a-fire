import { entryContentParts } from "../../entries/entry-content"
import { parseEntryFormatData } from "../../entries/entry-formats"
import { postFormatDataVariantUrls, tiptapImageVariantUrls } from "../../uploads/upload-urls"
import type { RoundCoverPayload } from "./round-runtime.types"

export function serializeRoundCover(
  artifact: { id: number; entry_id: number; entry: { format?: string; format_data: unknown }; user: { username: string } },
  revealContributor: boolean,
  content: unknown,
): RoundCoverPayload {
  const data = postFormatDataVariantUrls(parseEntryFormatData(artifact.entry.format_data), "w1200")
  const parts = entryContentParts(tiptapImageVariantUrls(content, "w1200"), artifact.entry.format, data)
  return {
    id: String(artifact.id),
    entryId: String(artifact.entry_id),
    imageUrl: parts.images[0] ?? "",
    alt: String(data?.title ?? "").trim() || "Cover art",
    ...(revealContributor ? { contributorName: artifact.user.username } : {}),
  }
}

