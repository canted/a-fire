import { withNoteDocumentTransaction } from "./note-document-transaction"
import type { Prisma } from "@prisma/client"
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"
import type { Doc } from "yjs"
import { createYdocFromStoredState, createYdocFromTiptapContent, encodeYdocState, insertYdocContentBlocks, replaceYdocContent, encodeTiptapContentAsYdocState, HocuspocusService } from "../../../realtime/hocuspocus.service"
import { RealtimeService } from "../../../realtime/realtime.service"
import { capturePageCreated } from "../../../runtime/posthog"
import { findUnsupportedMediaSrcs, normalizePrivateUploadUrls } from "../uploads/upload-urls"
import { type AudioInsertionTarget } from "./page-content-blocks"

const DEFAULT_TIPTAP_DOC: TiptapDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [] }],
}

export type PagePayload = {
  page: {
    id: number
    title: string | null
    icon: string | null
    room_id?: number | null
    parent_id?: number | null
    content: unknown
    version?: number | null
    can_manage?: boolean
  }
}

type CreatePageAttrs = {
  room_id?: number
  title?: string
  icon?: string
  parent_id?: number | null
  insert_parent_link?: boolean
}

type TiptapNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

type TiptapDoc = {
  type: "doc"
  content?: TiptapNode[]
}

const toId = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null
  return typeof value === "number" ? value : Number(value)
}

@Injectable()
export class PagesWriteService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(RealtimeService)
  private readonly realtime!: RealtimeService

  @Inject(HocuspocusService)
  private readonly hocuspocus?: HocuspocusService

  async createPage(userId: number, attrs: CreatePageAttrs): Promise<PagePayload> {
    const communityId = attrs.room_id
    if (!communityId) throw new NotFoundException("room_id is required")
    const communityIdValue = toId(communityId) ?? 0
    const parentId = toId(attrs.parent_id)

    const membership = await this.prisma.roomMembership.findFirst({
      where: { room_id: communityId, user_id: userId, disabled: false, room: { deleted_at: null } },
    })
    if (!membership) throw new ForbiddenException("Forbidden")

    if (parentId) {
      const parent = await this.prisma.page.findUnique({ where: { id: parentId } })
      if (!parent || parent.deleted_at || parent.room_id !== communityIdValue) {
        throw new ForbiddenException("Invalid parent page")
      }
    }

    const page = await this.prisma.page.create({
      data: {
        title: attrs.title ?? null,
        icon: attrs.icon ?? null,
        room_id: communityIdValue,
        parent_id: parentId,
        created_at: new Date(),
        updated_at: new Date(),
      },
    })

    await this.prisma.document.create({
      data: {
        docable_type: "Note",
        docable_id: page.id,
        content: DEFAULT_TIPTAP_DOC as Prisma.InputJsonValue,
        ydoc_state: encodeTiptapContentAsYdocState(DEFAULT_TIPTAP_DOC),
        version: 1,
        created_at: new Date(),
        updated_at: new Date(),
      },
    })

    if (parentId && attrs.insert_parent_link) {
      await this.insertParentNoteLink(parentId, page.id, userId)
    }

    capturePageCreated({
      userId,
      roomId: page.room_id ?? null,
      pageId: page.id,
      source: attrs.parent_id ? "page_tree_child" : "page_tree",
    })

    return this.payload(page.id, userId)
  }

  async updatePage(pageId: number, userId: number, attrs: { title?: string | null; icon?: string | null }): Promise<PagePayload> {
    const page = await this.prisma.page.findUnique({ where: { id: toId(pageId) ?? 0 } })
    if (!page || page.deleted_at) throw new NotFoundException("Not Found")

    const membership = page.room_id
      ? await this.prisma.roomMembership.findFirst({
          where: { room_id: page.room_id, user_id: userId, disabled: false, room: { deleted_at: null } },
        })
      : null
    if (page.room_id && !membership) throw new ForbiddenException("Forbidden")

    await this.prisma.page.update({
      where: { id: page.id },
      data: { title: attrs.title ?? page.title, icon: attrs.icon ?? page.icon, updated_at: new Date() },
    })

    const pageIdNumber = Number(page.id)
    this.realtime.emit("NoteChannel", this.realtime.noteRoom(pageIdNumber), {
      type: "meta",
      page_id: pageIdNumber,
      title: attrs.title ?? page.title,
      icon: attrs.icon ?? page.icon,
      actor_id: userId,
    })

    return this.payload(page.id, userId)
  }

  async saveContent(pageId: number, userId: number, content: unknown, expectedVersion?: unknown): Promise<PagePayload> {
    const normalizedContent = normalizeUploadUrls(content ?? DEFAULT_TIPTAP_DOC)
    assertPersistableContent(normalizedContent)
    const savedContent = await this.mutateStoredDocument(pageId, userId, document =>
      replaceYdocContent(document, normalizeTiptapDoc(normalizedContent)), { expectedVersion })
    const pageIdNumber = Number(pageId)
    this.realtime.emit("NoteChannel", this.realtime.noteRoom(pageIdNumber), {
      type: "content",
      page_id: pageIdNumber,
      content: savedContent.content as Prisma.InputJsonValue,
      version: savedContent.version,
      actor_id: userId,
    })

    const payload = await this.payload(pageId, userId)
    return { page: { ...payload.page, content: savedContent.content, version: savedContent.version } }
  }

  async prependContentBlocks(
    pageId: number,
    userId: number,
    attrs: { blocks?: unknown; position?: "top" | "after_audio"; audio_asset_id?: unknown; audio_node_id?: unknown },
  ): Promise<PagePayload> {
    if (attrs.position && attrs.position !== "top" && attrs.position !== "after_audio") {
      throw new BadRequestException("Unsupported block position")
    }

    const blocks = parseTiptapBlocks(attrs.blocks)
    assertPersistableContent(buildTiptapDoc(blocks))
    const page = await this.requireWritablePage(pageId, userId)
    const pageIdNumber = Number(page.id)
    const position = attrs.position ?? "top"
    const content =
      position === "after_audio"
        ? await this.insertBlocksAfterAudio(page.id, pageIdNumber, userId, blocks, parseAudioInsertionTarget(attrs))
        : await this.prependBlocks(page.id, pageIdNumber, userId, blocks)

    this.realtime.emit("NoteChannel", this.realtime.noteRoom(pageIdNumber), {
      type: "content",
      page_id: pageIdNumber,
      content,
      actor_id: userId,
    })

    return this.payload(page.id, userId)
  }

  private async prependBlocks(pageId: number, pageIdNumber: number, userId: number, blocks: TiptapNode[]) {
    const hocuspocusContent = await this.hocuspocus?.prependPageContentBlocks(pageIdNumber, userId, blocks)
    return hocuspocusContent ?? (await this.prependBlocksInStoredDocument(pageId, userId, blocks))
  }

  private async insertBlocksAfterAudio(
    pageId: number,
    pageIdNumber: number,
    userId: number,
    blocks: TiptapNode[],
    target: AudioInsertionTarget,
  ) {
    let hocuspocusContent: TiptapDoc | null | undefined
    try {
      hocuspocusContent = await this.hocuspocus?.insertPageContentBlocksAfterAudio?.(pageIdNumber, userId, blocks, target)
    } catch (error) {
      if (error instanceof Error && error.message === "Audio node not found") {
        throw new BadRequestException("Audio node not found")
      }
      throw error
    }
    return hocuspocusContent ?? (await this.insertBlocksAfterAudioInStoredDocument(pageId, userId, blocks, target))
  }

  async deletePage(pageId: number, userId: number): Promise<void> {
    const page = await this.prisma.page.findUnique({ where: { id: toId(pageId) ?? 0 } })
    if (!page || page.deleted_at) throw new NotFoundException("Not Found")

    const canManage = page.room_id
      ? await this.prisma.room.findFirst({
          where: { id: toId(page.room_id) ?? 0, owner_id: toId(userId) ?? 0, deleted_at: null },
          select: { id: true },
        })
      : null

    if (page.room_id && !canManage) throw new ForbiddenException("Forbidden")

    await this.prisma.page.update({ where: { id: page.id }, data: { deleted_at: new Date(), updated_at: new Date() } })
  }

  private async payload(pageId: number, userId: number): Promise<PagePayload> {
    const page = await this.prisma.page.findUnique({ where: { id: toId(pageId) ?? 0 } })
    if (!page || page.deleted_at) throw new NotFoundException("Not Found")

    const document = await this.prisma.document.findFirst({
      where: { docable_type: "Note", docable_id: page.id },
    })

    const canManage = page.room_id
      ? await this.prisma.room.findFirst({
          where: { id: toId(page.room_id) ?? 0, owner_id: toId(userId) ?? 0, deleted_at: null },
          select: { id: true },
        })
      : null

    return {
      page: {
        id: page.id,
        title: page.title,
        icon: page.icon,
        room_id: page.room_id ?? null,
        parent_id: page.parent_id ?? null,
        content: normalizeUploadUrls(document?.content ?? DEFAULT_TIPTAP_DOC),
        version: document?.version ?? 1,
        can_manage: Boolean(canManage),
      },
    }
  }

  private async requireWritablePage(pageId: number, userId: number, database: Prisma.TransactionClient = this.prisma) {
    const page = await database.page.findUnique({ where: { id: toId(pageId) ?? 0 } })
    if (!page || page.deleted_at) throw new NotFoundException("Not Found")

    const membership = page.room_id
      ? await database.roomMembership.findFirst({
          where: { room_id: page.room_id, user_id: userId, disabled: false, room: { deleted_at: null } },
        })
      : null
    if (page.room_id && !membership) throw new ForbiddenException("Forbidden")

    return page
  }

  private async insertParentNoteLink(parentId: number, childId: number, userId: number): Promise<void> {
    const parentIdNumber = Number(parentId)
    const content = await this.prependBlocks(parentId, parentIdNumber, userId, [
      { type: "noteLink", attrs: { noteId: childId } },
    ])

    this.realtime.emit("NoteChannel", this.realtime.noteRoom(parentIdNumber), {
      type: "content",
      page_id: parentIdNumber,
      content,
      actor_id: userId,
    })
  }

  private async prependBlocksInStoredDocument(pageId: number, userId: number, blocks: TiptapNode[]): Promise<TiptapDoc> {
    return this.mutateStoredDocument(pageId, userId, document => insertYdocContentBlocks(document, blocks)).then(saved => saved.content)
  }

  private async insertBlocksAfterAudioInStoredDocument(
    pageId: number,
    userId: number,
    blocks: TiptapNode[],
    target: AudioInsertionTarget,
  ): Promise<TiptapDoc> {
    return this.mutateStoredDocument(pageId, userId, document => {
      try { return insertYdocContentBlocks(document, blocks, target) }
      catch (error) {
        if (error instanceof Error && error.message === "Audio node not found") throw new BadRequestException("Audio node not found")
        throw error
      }
    }).then(saved => saved.content)
  }

  private async mutateStoredDocument(
    pageId: number,
    userId: number,
    mutate: (document: Doc) => TiptapDoc,
    replacement?: { expectedVersion: unknown },
  ): Promise<{ content: TiptapDoc; version: number }> {
    return withNoteDocumentTransaction(this.prisma, pageId, async transaction => {
      await this.requireWritablePage(pageId, userId, transaction)
      const document = await transaction.document.findFirst({ where: { docable_type: "Note", docable_id: pageId } })
      const version = document?.version ?? 0
      if (replacement) {
        if (typeof replacement.expectedVersion !== "number" || !Number.isSafeInteger(replacement.expectedVersion) || replacement.expectedVersion < 0) {
          throw new BadRequestException("expected_version must be a nonnegative integer")
        }
        if (replacement.expectedVersion !== version) throw new ConflictException("This Note changed elsewhere. Your draft has not been saved.")
      }
      const current = document ? normalizeTiptapDoc(document.content) : { type: "doc" as const, content: [] }
      const ydoc = createYdocFromStoredState(document?.ydoc_state) ?? createYdocFromTiptapContent(current)
      let content: TiptapDoc
      let ydocState: ReturnType<typeof encodeYdocState>
      try {
        content = normalizeTiptapDoc(normalizeUploadUrls(mutate(ydoc)))
        assertPersistableContent(content)
        ydocState = encodeYdocState(ydoc)
      } finally { ydoc.destroy() }
      if (document) {
        await transaction.document.update({
          where: { id: document.id },
          data: { content: content as Prisma.InputJsonValue, ydoc_state: ydocState, version: { increment: 1 }, updated_at: new Date() },
        })
      } else {
        await transaction.document.create({ data: {
          docable_type: "Note", docable_id: pageId, content: content as Prisma.InputJsonValue,
          ydoc_state: ydocState, version: 1, created_at: new Date(), updated_at: new Date(),
        } })
      }
      return { content, version: version + 1 }
    })
  }

}

function parseAudioInsertionTarget(attrs: { audio_asset_id?: unknown; audio_node_id?: unknown }): AudioInsertionTarget {
  const audioAssetId = toId(attrs.audio_asset_id as number | string | null | undefined)
  if (!audioAssetId) throw new BadRequestException("audio_asset_id is required")

  const audioNodeId = typeof attrs.audio_node_id === "string" && attrs.audio_node_id.trim().length
    ? attrs.audio_node_id.trim()
    : null

  return { audioAssetId, audioNodeId }
}

function parseTiptapBlocks(value: unknown): TiptapNode[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException("blocks must be a non-empty array")
  }

  return value.map((node) => {
    if (!isTiptapNode(node) || node.type === "doc") {
      throw new BadRequestException("blocks must contain Tiptap block nodes")
    }
    return cloneTiptapNode(node)
  })
}

function isTiptapNode(value: unknown): value is TiptapNode {
  return Boolean(value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string")
}

function cloneTiptapNode(node: TiptapNode): TiptapNode {
  return {
    type: node.type,
    ...(node.attrs ? { attrs: { ...node.attrs } } : {}),
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(node.marks ? { marks: node.marks.map((mark) => ({ ...mark, ...(mark.attrs ? { attrs: { ...mark.attrs } } : {}) })) } : {}),
    ...(node.content ? { content: node.content.map(cloneTiptapNode) } : {}),
  }
}

function normalizeTiptapDoc(content: unknown): TiptapDoc {
  if (content && typeof content === "object" && (content as { type?: unknown }).type === "doc") {
    return {
      type: "doc",
      content: Array.isArray((content as { content?: unknown }).content)
        ? ((content as { content: TiptapNode[] }).content ?? [])
        : [],
    }
  }

  return DEFAULT_TIPTAP_DOC
}

function buildTiptapDoc(nodes: TiptapNode[]): TiptapDoc {
  return {
    type: "doc",
    content: nodes.length ? nodes : DEFAULT_TIPTAP_DOC.content,
  }
}

function normalizeUploadUrls(content: unknown): unknown {
  return normalizePrivateUploadUrls(content).value
}

function assertPersistableContent(content: unknown): void {
  const unsupportedMediaSrcs = findUnsupportedMediaSrcs(content)
  if (unsupportedMediaSrcs.length > 0) {
    throw new BadRequestException("Media must be uploaded before saving content")
  }
}
