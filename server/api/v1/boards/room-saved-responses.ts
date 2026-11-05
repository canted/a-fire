import type { PrismaService } from "../../../prisma/prisma.service"
import { extractPlainText } from "../../../realtime/document-content"
import { parseEntryFormatData } from "../entries/entry-formats"

type Shared = { id: number; user_id: number | null; source_entry_id: number | null }
type Response = { id: string; entryId: string; author: string; text: string; savedAt: string; sourceTitle: string }

/** Stars select existing room replies; private saved documents never cross this boundary. */
export async function roomSavedResponses(prisma: PrismaService, entries: Shared[]) {
  const result = new Map<number, Response[]>()
  if (!entries.length) return result
  const sources = new Map(entries.map(entry => [entry.id, entry]))
  const keeps = await prisma.entry.findMany({ where: {
    source_shared_entry_id: { in: entries.map(entry => entry.id) }, room_id: null,
    creation_origin: "project_feedback", status: "published", source_reply_id: { not: null },
  }, orderBy: { published_at: "asc" } })
  for (const keep of keeps) {
    const shared = sources.get(keep.source_shared_entry_id!)
    if (!shared || keep.user_id !== shared.user_id || keep.source_entry_id !== shared.source_entry_id) continue
    const data = parseEntryFormatData(keep.format_data)
    const ids = Array.isArray(data?.saved_reply_ids)
      ? data.saved_reply_ids.filter((id): id is number => Number.isSafeInteger(id)) : [keep.source_reply_id!]
    const replies = await prisma.reply.findMany({ where: { id: { in: ids }, entry_id: shared.id, status: "published" },
      include: { user: true }, orderBy: [{ published_at: "asc" }, { id: "asc" }] })
    if (!replies.length) continue
    const documents = await prisma.document.findMany({ where: { docable_type: "Reply", docable_id: { in: replies.map(reply => reply.id) } } })
    const text = replies.map(reply => extractPlainText(documents.find(doc => doc.docable_id === reply.id)?.content)).filter(Boolean).join("\n\n")
    const responses = result.get(shared.id) ?? []
    responses.push({ id: String(replies[0].id), entryId: String(shared.id), author: replies[0].user?.username || "Former member",
      text: text || "Shared media feedback", savedAt: (keep.published_at ?? keep.created_at).toISOString(), sourceTitle: "Saved reply" })
    result.set(shared.id, responses)
  }
  return result
}
