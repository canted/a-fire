import { describe, expect, it, vi } from "vitest"
import { TiptapTransformer } from "@hocuspocus/transformer"
import * as Y from "yjs"
import type { Doc } from "yjs"
import { replaceYdocContent, insertYdocContentBlocks, createYdocFromTiptapContent, encodeTiptapContentAsYdocState, HocuspocusService, PAGE_TIPTAP_EXTENSIONS } from "@server/realtime/hocuspocus.service"

function makePrisma(overrides: Partial<any> = {}) {
  const prisma = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([{ room_id: null }]),
    page: { findUnique: vi.fn() },
    roomMembership: { findFirst: vi.fn() },
    document: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    ...overrides,
  }
  prisma.$transaction.mockImplementation(callback => callback(prisma))
  return prisma
}

function makeService(overrides: Partial<any> = {}) {
  const service = new HocuspocusService()
  ;(service as any).prisma = makePrisma(overrides.prisma ?? {})
  ;(service as any).authService = overrides.authService ?? {}
  return service
}

function makeDoc(): { ydoc: Doc; json: any } {
  const json = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
  }
  const ydoc = TiptapTransformer.toYdoc(json)
  return { ydoc, json }
}

function makeAudioDoc(): { ydoc: Doc; json: any } {
  const json = {
    type: "doc",
    content: [
      { type: "audio", attrs: { audioAssetId: 41, title: "Bridge idea", status: "processing" } },
      { type: "video", attrs: { videoAssetId: 44, title: "Launch clip", status: "processing" } },
      { type: "paragraph", content: [{ type: "text", text: "Notes after the upload" }] },
    ],
  }
  const ydoc = TiptapTransformer.toYdoc(json, "default", PAGE_TIPTAP_EXTENSIONS)
  return { ydoc, json }
}

function expectYdocStateToMatchContent(state: unknown, json: any) {
  expect(Buffer.isBuffer(state)).toBe(true)
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, state as Uint8Array)
  expect(TiptapTransformer.fromYdoc(ydoc, "default")).toEqual(json)
}

describe("HocuspocusService", () => {
  it("parses page document names", () => {
    const service = makeService()
    const parse = (service as any).pageIdFromDocumentName.bind(service)

    expect(parse("page:12")).toBe(12)
    expect(parse("page:0")).toBeNull()
    expect(parse("page:abc")).toBeNull()
    expect(parse("entry:12")).toBeNull()
  })

  it("persists updates for existing documents", async () => {
    const { ydoc, json } = makeDoc()
    const prisma = makePrisma({
      page: { findUnique: vi.fn(async () => ({ id: 9n, room_id: null })) },
      document: {
        findFirst: vi.fn(async () => ({ id: 42 })),
        update: vi.fn(async () => ({})),
        create: vi.fn(async () => ({})),
      },
    })
    const service = new HocuspocusService()
    ;(service as any).prisma = prisma
    ;(service as any).authService = {}

    await (service as any).persistDocument("page:9", ydoc, { userId: 1 })

    expect(prisma.document.update).toHaveBeenCalledTimes(1)
    const updateCall = prisma.document.update.mock.calls[0]?.[0]
    expect(updateCall?.where?.id).toBe(42)
    expect(updateCall?.data?.content).toEqual(json)
    expect(updateCall?.data?.version).toEqual({ increment: 1 })
    expectYdocStateToMatchContent(updateCall?.data?.ydoc_state, json)
    expect(prisma.document.create).not.toHaveBeenCalled()
  })

  it("loads stored audio nodes into collaborative page documents", () => {
    const { ydoc, json } = makeAudioDoc()

    const loaded = TiptapTransformer.fromYdoc(ydoc, "default")

    expect(loaded).toEqual(json)
  })

  it("persists audio nodes from collaborative page documents", async () => {
    const { ydoc, json } = makeAudioDoc()
    const prisma = makePrisma({
      page: { findUnique: vi.fn(async () => ({ id: 9n, room_id: null })) },
      document: {
        findFirst: vi.fn(async () => ({ id: 42 })),
        update: vi.fn(async () => ({})),
        create: vi.fn(async () => ({})),
      },
    })
    const service = new HocuspocusService()
    ;(service as any).prisma = prisma
    ;(service as any).authService = {}

    await (service as any).persistDocument("page:9", ydoc, { userId: 1 })

    const updateCall = prisma.document.update.mock.calls[0]?.[0]
    expect(updateCall?.data?.content).toEqual(json)
    expectYdocStateToMatchContent(updateCall?.data?.ydoc_state, json)
  })

  it("creates new documents when missing", async () => {
    const { ydoc, json } = makeDoc()
    const prisma = makePrisma({
      page: { findUnique: vi.fn(async () => ({ id: 5n, room_id: null })) },
      document: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
      },
    })
    const service = new HocuspocusService()
    ;(service as any).prisma = prisma
    ;(service as any).authService = {}

    await (service as any).persistDocument("page:5", ydoc, { userId: 1 })

    expect(prisma.document.create).toHaveBeenCalledTimes(1)
    const createCall = prisma.document.create.mock.calls[0]?.[0]
    expect(createCall?.data?.docable_id).toBe(5)
    expect(createCall?.data?.content).toEqual(json)
    expectYdocStateToMatchContent(createCall?.data?.ydoc_state, json)
  })

  it("can encode JSON content into a persisted ydoc state update", () => {
    const { json } = makeAudioDoc()
    const state = encodeTiptapContentAsYdocState(json)

    expectYdocStateToMatchContent(state, json)
  })

  it("rejects access when membership is missing", async () => {
    const prisma = makePrisma({
      page: { findUnique: vi.fn(async () => ({ id: 5n, room_id: 3n })) },
      roomMembership: { findFirst: vi.fn(async () => null) },
    })
    const service = new HocuspocusService()
    ;(service as any).prisma = prisma
    ;(service as any).authService = {}

    await expect((service as any).ensurePageAccess(5, 99)).rejects.toThrow("Forbidden")
  })
})


it("round-trips an uploaded file in a Note through collaborative persistence", () => {
  const content = { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "Keep this note body" }] },
    { type: "file", attrs: { src: "/api/v1/uploads/files/fixture", filename: "synthetic.txt", size: 52, contentType: "text/plain" } },
  ] };
  const state = encodeTiptapContentAsYdocState(content);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  expect(TiptapTransformer.fromYdoc(doc, "default")).toMatchObject(content);
  doc.destroy();
});


it.each(["top", "audio"] as const)("preserves concurrent edits to existing Yjs nodes during %s insertion", position => {
  const base = createYdocFromTiptapContent({ type: "doc", content: [
    { type: "audio", attrs: { audioAssetId: 41, nodeId: "anchor" } },
    { type: "paragraph", content: [{ type: "text", text: "Original" }] },
  ] })
  const editor = new Y.Doc()
  const worker = new Y.Doc()
  try {
    const initial = Y.encodeStateAsUpdate(base)
    Y.applyUpdate(editor, initial)
    Y.applyUpdate(worker, initial)
    const paragraph = editor.getXmlFragment("default").get(1) as Y.XmlElement
    const text = paragraph.get(0) as Y.XmlText
    text.insert(text.length, " edited")
    insertYdocContentBlocks(worker, [{ type: "paragraph", content: [{ type: "text", text: "Inserted" }] }], position === "audio" ? { audioAssetId: 41, audioNodeId: "anchor" } : undefined)
    Y.applyUpdate(editor, Y.encodeStateAsUpdate(worker))
    Y.applyUpdate(worker, Y.encodeStateAsUpdate(editor))
    const merged = TiptapTransformer.fromYdoc(editor, "default")
    expect(TiptapTransformer.fromYdoc(worker, "default")).toEqual(merged)
    expect(JSON.stringify(merged)).toContain("Original edited")
    expect(JSON.stringify(merged).split("Inserted").length - 1).toBe(1)
  } finally { base.destroy(); editor.destroy(); worker.destroy() }
})

 it("does not resurrect replaced content when a stale collaboration snapshot arrives", () => {
  const stored = createYdocFromTiptapContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Removed" }] }] })
  const stale = new Y.Doc()
  try {
    Y.applyUpdate(stale, Y.encodeStateAsUpdate(stored))
    const replacement = { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text: "Replacement" }] }] }
    replaceYdocContent(stored, replacement)
    Y.applyUpdate(stored, Y.encodeStateAsUpdate(stale))
    Y.applyUpdate(stale, Y.encodeStateAsUpdate(stored))
    expect(TiptapTransformer.fromYdoc(stored, "default")).toEqual(replacement)
    expect(TiptapTransformer.fromYdoc(stale, "default")).toEqual(replacement)
  } finally { stored.destroy(); stale.destroy() }
})
