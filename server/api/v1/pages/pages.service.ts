import { presentImageDocuments } from "../uploads/image-presentation"
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"
import { normalizePrivateUploadUrls } from "../uploads/upload-urls"

const DEFAULT_TIPTAP_DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [] }],
}

export type PagePayload = {
  id: number
  title: string | null
  icon: string | null
  room_id?: number | null
  parent_id?: number | null
  content: unknown
  version?: number | null
  can_manage?: boolean
}

export type PageTreeNode = {
  id: number
  title: string | null
  icon: string | null
  parent_id: number | null
  updated_at: string | null
  children: PageTreeNode[]
}

export type PageTreePayload = {
  room_id: number
  pages: PageTreeNode[]
}

const toId = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null
  return typeof value === "number" ? value : Number(value)
}

@Injectable()
export class PagesService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  async fetchPage(id: number, userId: number): Promise<PagePayload> {
    const page = await this.prisma.page.findUnique({ where: { id: toId(id) ?? 0 } })
    if (!page || page.deleted_at) throw new NotFoundException("Not Found")

    if (page.room_id) {
      const membership = await this.prisma.roomMembership.findFirst({
        where: { room_id: page.room_id, user_id: userId, disabled: false, room: { deleted_at: null } },
      })
      if (!membership) throw new ForbiddenException("Forbidden")
    }

    const doc = await this.prisma.document.findFirst({
      where: { docable_type: "Note", docable_id: page.id },
    })

    const canManage = page.room_id
      ? Boolean(
          await this.prisma.room.findFirst({
            where: { id: toId(page.room_id) ?? 0, owner_id: toId(userId) ?? 0, deleted_at: null },
            select: { id: true },
          }),
        )
      : false

    return {
      id: Number(page.id),
      title: page.title,
      icon: page.icon,
      room_id: page.room_id ? Number(page.room_id) : null,
      parent_id: page.parent_id ? Number(page.parent_id) : null,
      content: (await presentImageDocuments(this.prisma, [normalizePrivateUploadUrls(doc?.content ?? DEFAULT_TIPTAP_DOC).value]))[0],
      version: doc?.version ?? 1,
      can_manage: canManage,
    }
  }

  async fetchTree(communityId: number, userId: number): Promise<PageTreePayload> {
    const membership = await this.prisma.roomMembership.findFirst({
      where: { room_id: communityId, user_id: userId, disabled: false, room: { deleted_at: null } },
    })
    if (!membership) throw new ForbiddenException("Forbidden")

    const pages = await this.prisma.page.findMany({
      where: { room_id: communityId, deleted_at: null },
      orderBy: { title: "asc" },
      select: { id: true, title: true, icon: true, parent_id: true, updated_at: true },
    })

    const nodes = new Map<number, PageTreeNode>()
    pages.forEach((page) => {
      const id = Number(page.id)
      const updatedAt =
        page.updated_at instanceof Date
          ? page.updated_at.toISOString()
          : page.updated_at
            ? new Date(page.updated_at).toISOString()
            : null
      nodes.set(id, {
        id,
        title: page.title,
        icon: page.icon,
        parent_id: page.parent_id ? Number(page.parent_id) : null,
        updated_at: updatedAt,
        children: [],
      })
    })

    const roots: PageTreeNode[] = []
    nodes.forEach((node) => {
      if (node.parent_id && nodes.has(node.parent_id)) {
        nodes.get(node.parent_id)?.children.push(node)
      } else {
        roots.push(node)
      }
    })

    return { room_id: communityId, pages: roots }
  }
}
