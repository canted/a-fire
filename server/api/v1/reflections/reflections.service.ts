import { reflectionSummaryScope } from "./reflection-summary-scope"
import { findAvailableChatAttachment } from "../../v2/rooms/chat-visibility"
import { withNoteDocumentTransaction } from "../pages/note-document-transaction"
import type { Prisma } from "@prisma/client"
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"
import { BossService } from "../../../queue/boss.service"
import { RealtimeService } from "../../../realtime/realtime.service"
import { captureReflectionCreated, captureReflectionRemoved } from "../../../runtime/posthog"
import { isProjectEntry } from "../projects/project-access"

export type ReflectionPayload = {
  page_id: number
  page_title: string | null
  page_icon: string | null
  count: number
  mine: boolean
}

@Injectable()
export class ReflectionsService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(BossService)
  private readonly boss!: BossService

  @Inject(RealtimeService)
  private readonly realtime!: RealtimeService

  async createForPost(postId: number, userId: number, pageId: number): Promise<ReflectionPayload[]> {
    const post = await this.prisma.entry.findUnique({ where: { id: postId } })
    if (!post) throw new NotFoundException("Not Found")
    if (isProjectEntry(post)) throw new ForbiddenException("Reflections belong to circle submissions")
    await this.ensureMember(post.room_id, userId)

    const reflection = await this.createAndQueue("Post", post.id, userId, pageId, post.room_id)
    const payload = await this.listForReflectable("Post", post.id, userId, post.room_id)
    this.realtime.emit("EntryChannel", this.realtime.entryRoom(post.id), {
      type: "post_reflections",
      entry_id: post.id,
      reflections: payload,
    })

    if (reflection.wasCreated) captureReflectionCreated({
      userId,
      reflectionId: reflection.id,
      reflectableType: "Post",
      reflectableId: post.id,
      pageId,
      roomId: post.room_id,
    })

    return payload
  }

  async deleteForPost(postId: number, userId: number, pageId: number): Promise<ReflectionPayload[]> {
    const post = await this.prisma.entry.findUnique({ where: { id: postId } })
    if (!post) throw new NotFoundException("Not Found")
    if (isProjectEntry(post)) throw new ForbiddenException("Reflections belong to circle submissions")
    await this.ensureMember(post.room_id, userId)

    await withNoteDocumentTransaction(this.prisma, pageId, async transaction => {
      await assertReflectionDestination(transaction, pageId, post.room_id, userId)
      await transaction.reflection.deleteMany({
        where: { reflectable_type: "Post", reflectable_id: post.id, page_id: pageId },
      })
    })

    const payload = await this.listForReflectable("Post", post.id, userId, post.room_id)
    this.realtime.emit("EntryChannel", this.realtime.entryRoom(post.id), {
      type: "post_reflections",
      entry_id: post.id,
      reflections: payload,
    })
    captureReflectionRemoved({
      userId,
      reflectableType: "Post",
      reflectableId: post.id,
      pageId,
      roomId: post.room_id,
    })
    return payload
  }

  async createForReply(replyId: number, userId: number, pageId: number): Promise<ReflectionPayload[]> {
    const reply = await this.prisma.reply.findUnique({ where: { id: replyId } })
    if (!reply || reply.entry_id === null) throw new NotFoundException("Not Found")
    const post = await this.prisma.entry.findUnique({ where: { id: reply.entry_id } })
    if (!post) throw new NotFoundException("Not Found")
    if (isProjectEntry(post)) throw new ForbiddenException("Reflections belong to circle submissions")
    await this.ensureMember(post.room_id, userId)

    const reflection = await this.createAndQueue("Reply", reply.id, userId, pageId, post.room_id)
    const payload = await this.listForReflectable("Reply", reply.id, userId, post.room_id)
    this.realtime.emit("EntryChannel", this.realtime.entryRoom(post.id), {
      type: "reply_reflections",
      entry_id: post.id,
      reply_id: reply.id,
      reflections: payload,
    })

    if (reflection.wasCreated) captureReflectionCreated({
      userId,
      reflectionId: reflection.id,
      reflectableType: "Reply",
      reflectableId: reply.id,
      pageId,
      entryId: post.id,
      roomId: post.room_id,
    })

    return payload
  }

  async deleteForReply(replyId: number, userId: number, pageId: number): Promise<ReflectionPayload[]> {
    const reply = await this.prisma.reply.findUnique({ where: { id: replyId } })
    if (!reply || reply.entry_id === null) throw new NotFoundException("Not Found")
    const post = await this.prisma.entry.findUnique({ where: { id: reply.entry_id } })
    if (!post) throw new NotFoundException("Not Found")
    if (isProjectEntry(post)) throw new ForbiddenException("Reflections belong to circle submissions")
    await this.ensureMember(post.room_id, userId)

    await withNoteDocumentTransaction(this.prisma, pageId, async transaction => {
      await assertReflectionDestination(transaction, pageId, post.room_id, userId)
      await transaction.reflection.deleteMany({
        where: { reflectable_type: "Reply", reflectable_id: reply.id, page_id: pageId },
      })
    })

    const payload = await this.listForReflectable("Reply", reply.id, userId, post.room_id)
    this.realtime.emit("EntryChannel", this.realtime.entryRoom(post.id), {
      type: "reply_reflections",
      entry_id: post.id,
      reply_id: reply.id,
      reflections: payload,
    })
    captureReflectionRemoved({
      userId,
      reflectableType: "Reply",
      reflectableId: reply.id,
      pageId,
      entryId: post.id,
      roomId: post.room_id,
    })
    return payload
  }

  private createAndQueue(type: "Post" | "Reply", id: number, userId: number, pageId: number, sourceRoomId: number | null) {
    return withNoteDocumentTransaction(this.prisma, pageId, async transaction => {
      await assertReflectionDestination(transaction, pageId, sourceRoomId, userId)
      await assertReflectionSource(transaction, type, id, sourceRoomId)
      const existing = await transaction.reflection.findFirst({
        where: { page_id: pageId, reflectable_type: type, reflectable_id: id, user_id: userId },
        orderBy: { id: "asc" },
      })
      if (existing) return { ...existing, wasCreated: false }
      const reflection = await transaction.reflection.create({ data: {
        page_id: pageId, reflectable_type: type, reflectable_id: id, user_id: userId,
        created_at: new Date(), updated_at: new Date(),
      } })
      await this.boss.enqueueInTransaction(transaction, "reflections.apply", { reflectionId: reflection.id })
      return { ...reflection, wasCreated: true }
    })
  }

  private async listForReflectable(type: "Post" | "Reply", id: number, userId: number, roomId: number | null): Promise<ReflectionPayload[]> {
    const reflections = await this.prisma.reflection.findMany({
      where: { reflectable_type: type, reflectable_id: id, ...reflectionSummaryScope(roomId) },
      include: { page: true },
    })

    const grouped = new Map<number, { page_title: string | null; page_icon: string | null; count: number; mine: boolean }>()
    reflections.forEach((reflection) => {
      if (!reflection.page || reflection.page.deleted_at) return
      const current = grouped.get(reflection.page_id) ?? {
        page_title: reflection.page?.title ?? null,
        page_icon: reflection.page?.icon ?? null,
        count: 0,
        mine: false,
      }
      const isMine = this.toNumber(reflection.user_id) === userId
      grouped.set(reflection.page_id, {
        page_title: current.page_title,
        page_icon: current.page_icon,
        count: current.count + 1,
        mine: current.mine || isMine,
      })
    })

    return Array.from(grouped.entries()).map(([page_id, data]) => ({
      page_id,
      page_title: data.page_title,
      page_icon: data.page_icon,
      count: data.count,
      mine: data.mine,
    }))
  }

  private async ensureMember(communityId: number | null, userId: number) {
    if (!communityId) return
    const membership = await this.prisma.roomMembership.findFirst({
      where: { room_id: communityId, user_id: userId, disabled: false },
    })
    if (!membership) throw new ForbiddenException("Forbidden")
  }

  private toNumber(value: number | string | null | undefined): number {
    if (value === null || value === undefined) return 0
    return typeof value === "number" ? Number(value) : Number(value)
  }
}

// Reflection badges are visible to the source circle, so destinations must stay in that circle.
// Both the request and the delayed worker use this policy.
export async function assertReflectionDestination(
  prisma: Prisma.TransactionClient,
  pageId: number,
  sourceRoomId: number | null,
  userId: number,
) {
  const page = await prisma.page.findUnique({ where: { id: pageId } })
  if (!page || page.deleted_at) throw new NotFoundException("Not Found")
  if (!sourceRoomId || page.room_id !== sourceRoomId) throw new ForbiddenException("Reflections must stay in the source circle")
  const membership = await prisma.roomMembership.findFirst({
    where: { room_id: page.room_id, user_id: userId, disabled: false, room: { deleted_at: null } },
    select: { id: true },
  })
  if (!membership) throw new ForbiddenException("Forbidden")
  return page
}

async function assertPublishedReflectionEntry(
  transaction: Prisma.TransactionClient,
  post: { id: number; status: string; room_id: number | null; project_id?: number | null; creation_origin?: string | null } | null,
  sourceRoomId: number | null,
) {
  if (!post || post.status !== "published") throw new ForbiddenException("Only published entries can be saved to Notes")
  if (isProjectEntry(post) || post.room_id !== sourceRoomId) {
    throw new ForbiddenException("Reflections must stay in the source circle")
  }
  if (post.creation_origin === "chat_attachment" && (!sourceRoomId || !await findAvailableChatAttachment(transaction, post.id, sourceRoomId))) {
    throw new ForbiddenException("Chat attachment is no longer available")
  }
}

/** Request and delayed worker share the same published-source boundary. */
export async function assertReflectionSource(transaction: Prisma.TransactionClient, type: string, id: number, sourceRoomId: number | null) {
  if (type !== "Post" && type !== "Reply") throw new ForbiddenException("Unsupported reflection source")
  if (type === "Reply") {
    const reply = await transaction.reply.findUnique({ where: { id } })
    if (!reply || reply.status !== "published") throw new ForbiddenException("Only published replies can be saved to Notes")
    const post = reply.entry_id === null ? null : await transaction.entry.findUnique({ where: { id: reply.entry_id } })
    await assertPublishedReflectionEntry(transaction, post, sourceRoomId)
  } else {
    const post = await transaction.entry.findUnique({ where: { id } })
    await assertPublishedReflectionEntry(transaction, post, sourceRoomId)
  }
}
