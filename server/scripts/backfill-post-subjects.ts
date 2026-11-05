import { PrismaClient, type Prisma } from "@prisma/client"
import { deriveEntrySubject, postSubjectPersistenceData } from "../api/v1/entries/entry-subjects"
import { ensureDatabaseUrl } from "../runtime/env"
import { loadEnv } from "../runtime/loadEnv"

const PAGE_SIZE = 200
const DEFAULT_TIPTAP_DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [] }],
}

type PostSubjectBackfillRow = {
  id: number
  document_content: unknown | null
}

type QueryRaw = <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>

type BackfillPrisma = {
  $queryRaw: QueryRaw
  entrySubject: {
    create: (args: { data: Prisma.EntrySubjectUncheckedCreateInput }) => Promise<unknown>
  }
}

export type PostSubjectBackfillSummary = {
  postsScanned: number
  subjectsCreated: number
  subjectsSkipped: number
}

export type PostSubjectBackfillOptions = {
  batchSize?: number
}

export async function backfillPostSubjects(
  prisma: BackfillPrisma,
  options: PostSubjectBackfillOptions = {},
): Promise<PostSubjectBackfillSummary> {
  const batchSize = options.batchSize ?? PAGE_SIZE
  const summary: PostSubjectBackfillSummary = {
    postsScanned: 0,
    subjectsCreated: 0,
    subjectsSkipped: 0,
  }
  let cursorId = 0

  while (true) {
    const rows = await prisma.$queryRaw<PostSubjectBackfillRow[]>`
      SELECT
        p.id::int AS id,
        d.content AS document_content
      FROM entries AS p
      LEFT JOIN documents AS d
        ON d.docable_type = 'Post'
        AND d.docable_id = p.id
      WHERE p.id > ${cursorId}
        AND NOT EXISTS (
          SELECT 1
          FROM entry_subjects AS ps
          WHERE ps.entry_id = p.id
        )
      ORDER BY p.id ASC
      LIMIT ${batchSize}
    `

    if (rows.length === 0) break

    for (const row of rows) {
      cursorId = row.id
      summary.postsScanned += 1

      const content = backfillContent(row)
      const subject = deriveEntrySubject(content)
      const subjectData = postSubjectPersistenceData(subject)

      try {
        await prisma.entrySubject.create({
          data: {
            entry_id: row.id,
            ...subjectData,
            created_at: new Date(),
            updated_at: new Date(),
          },
        })
        summary.subjectsCreated += 1
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error
        summary.subjectsSkipped += 1
      }
    }
  }

  return summary
}

function backfillContent(row: PostSubjectBackfillRow): unknown {
  return isTiptapDoc(row.document_content) ? row.document_content : DEFAULT_TIPTAP_DOC
}

function isTiptapDoc(value: unknown): value is { type?: string; content: unknown[] } {
  return Boolean(
    value && typeof value === "object" && !Array.isArray(value) && Array.isArray((value as { content?: unknown }).content),
  )
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002")
}

async function runFromCli(): Promise<void> {
  loadEnv()
  ensureDatabaseUrl()
  const prisma = new PrismaClient()

  try {
    const summary = await backfillPostSubjects(prisma)
    // eslint-disable-next-line no-console
    console.log(`Backfilled ${summary.subjectsCreated}/${summary.postsScanned} post subjects (${summary.subjectsSkipped} skipped).`)
  } finally {
    await prisma.$disconnect()
  }
}

if (process.argv[1]?.endsWith("backfill-post-subjects.ts") || process.argv[1]?.endsWith("backfill-post-subjects.js")) {
  runFromCli().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
