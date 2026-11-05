import { mockRawQuery } from "@tests/backend/helpers/query";
import { backfillPostSubjects } from "@server/scripts/backfill-post-subjects"
import { describe, expect, it, vi } from "vitest"

type BackfillRow = {
  id: number
  document_content: unknown | null
}

function makePrisma(rows: BackfillRow[], options: { failUniquePostIds?: number[] } = {}) {
  const created: Array<Record<string, unknown>> = []
  const failUniquePostIds = new Set(options.failUniquePostIds ?? [])

  return {
    $queryRaw: mockRawQuery(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const cursorId = Number(values[0] ?? 0)
      const limit = Number(values[1] ?? 200)
      return rows
        .filter((row) => row.id > cursorId)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit)
    }),
    entrySubject: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        if (failUniquePostIds.has(Number(args.data.entry_id))) {
          const error = new Error("Unique constraint failed") as Error & { code: string }
          error.code = "P2002"
          throw error
        }
        created.push(args.data)
        return { id: created.length, ...args.data }
      }),
    },
    created,
  }
}

describe("backfillPostSubjects", () => {
  it("creates missing Entry subjects from their authoritative Documents", async () => {
    const prisma = makePrisma([
      {
        id: 1,
        document_content: {
          type: "doc",
          content: [{ type: "image", attrs: { src: "/api/v1/uploads/12", alt: "Cover" } }],
        },
      },
      {
        id: 2,
        document_content: {
          type: "doc",
          content: [{ type: "audio", attrs: { audioAssetId: 7, title: "Bridge idea" } }],
        },
      },
      {
        id: 3,
        document_content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Loose text from an old post" }] }] },
      },
    ])

    const summary = await backfillPostSubjects(prisma, { batchSize: 2 })

    expect(summary).toEqual({ postsScanned: 3, subjectsCreated: 3, subjectsSkipped: 0 })
    expect(prisma.created).toEqual([
      expect.objectContaining({
        entry_id: 1,
        subject_type: "image",
        subject_key: "/api/v1/uploads/12",
        metadata: expect.objectContaining({ label: "Cover" }),
      }),
      expect.objectContaining({
        entry_id: 2,
        subject_type: "audio_asset",
        subject_id: 7,
        subject_key: "audio_asset:7",
        metadata: expect.objectContaining({ label: "Bridge idea" }),
      }),
      expect.objectContaining({
        entry_id: 3,
        subject_type: "plain_text",
        subject_key: "Loose text from an old post",
        metadata: expect.objectContaining({ label: "Loose text from an old post" }),
      }),
    ])
  })

  it("queries only posts missing stored subjects", async () => {
    const prisma = makePrisma([])

    await backfillPostSubjects(prisma)

    const sql = prisma.$queryRaw.mock.calls[0][0].join("")
    expect(sql).toContain("NOT EXISTS")
    expect(sql).toContain("entry_subjects")
  })

  it("skips rows that gained a subject concurrently", async () => {
    const prisma = makePrisma(
      [
        {
          id: 4,
          document_content: {
            type: "doc",
            content: [{ type: "image", attrs: { src: "/late.jpg" } }],
          },
        },
      ],
      { failUniquePostIds: [4] },
    )

    const summary = await backfillPostSubjects(prisma)

    expect(summary).toEqual({ postsScanned: 1, subjectsCreated: 0, subjectsSkipped: 1 })
    expect(prisma.created).toEqual([])
  })
})
