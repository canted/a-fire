import { RoomAccessService } from "../../v1/rooms/room-access.service"
import { Header, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common"
import { FileInterceptor } from "@nestjs/platform-express"
import { IMAGE_MULTIPART_OPTIONS } from "../../../uploads/images/image-policy"
import type { Request } from "express"
import { AuthGuard, RequestWithUser } from "../../v1/auth/auth.guard"
import { RoomsService } from "../../v1/rooms/rooms.service"
import { RoomBannersService } from "../../v1/rooms/room-banners.service"
import { NavigationService } from "../../v1/navigation/navigation.service"
import { serializeRoom, serializeRoomMembers, serializeFirstEntryPrompts, serializeSlideMenu } from "../serializers"
import { ChatService } from "./chat.service"
import { RepliesService } from "../../v1/replies/replies.service"

type RoomBody = {
  room?: { name?: string; porosity?: string | null; remove_avatar?: string | boolean }
  "room[name]"?: string
  "room[porosity]"?: string
  "room[remove_avatar]"?: string
}

type FirstEntryPromptsBody = {
  room_prompt?: string | null
  member_prompts?: Array<{
    membership_id?: number | string
    prompt?: string | null
  }>
}

type SideRoomBody = { name?: string; user_ids?: Array<number | string> }
type StatusBody = { status?: string }

@Controller("api/v2/rooms")
@UseGuards(AuthGuard)
export class RoomsController {
  @Inject(RoomAccessService)
  private readonly circleAccess!: RoomAccessService

  @Post(":id/visit")
  async visit(@Param("id") id: string, @Req() request: Request) {
    return this.circleAccess.visit(Number(id), (request as RequestWithUser).user?.id ?? 0)
  }

  @Inject(RoomsService)
  private readonly roomsService!: RoomsService

  @Inject(RoomBannersService)
  private readonly communityBannersService!: RoomBannersService

  @Inject(NavigationService)
  private readonly navigationService!: NavigationService

  @Inject(ChatService)
  private readonly chatService!: ChatService

  @Inject(RepliesService)
  private readonly repliesService!: RepliesService

  @Get()
  async index(@Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    const payload = serializeSlideMenu(await this.navigationService.slideMenu(userId ?? 0))
    return { rooms: payload.rooms }
  }

  @Get(":room_id")
  async show(@Param("room_id") roomId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return serializeRoom(await this.roomsService.fetchRoom(Number(roomId), userId ?? 0))
  }

  @Get(":room_id/members")
  async members(@Param("room_id") roomId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return serializeRoomMembers(await this.roomsService.listMembers(Number(roomId), userId ?? 0), Number(roomId))
  }

  @Get(":room_id/adjacent-rooms")
  async sideRooms(@Param("room_id") roomId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.roomsService.listAdjacentRooms(Number(roomId), userId)
  }

  @Post(":room_id/adjacent-rooms")
  async createSideRoom(@Param("room_id") roomId: string, @Body() body: SideRoomBody, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.roomsService.createSideRoom(Number(roomId), userId, {
      name: body?.name,
      userIds: (body?.user_ids ?? []).map(Number),
    })
  }

  @Post(":room_id/join")
  async joinRoom(@Param("room_id") roomId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.roomsService.joinRoom(Number(roomId), userId)
  }

  @Get(":room_id/join-requests")
  async joinRequests(@Param("room_id") roomId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.roomsService.listJoinRequests(Number(roomId), userId)
  }

  @Patch(":room_id/join-requests/:request_id")
  async reviewJoinRequest(
    @Param("room_id") roomId: string,
    @Param("request_id") requestId: string,
    @Body() body: StatusBody,
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.roomsService.reviewJoinRequest(Number(roomId), Number(requestId), userId, body?.status as never)
  }

  @Get(":room_id/member-invitations")
  async memberInvitations(@Param("room_id") roomId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.roomsService.listMemberInvitations(Number(roomId), userId)
  }

  @Post(":room_id/member-invitations")
  async inviteMember(
    @Param("room_id") roomId: string,
    @Body() body: { user_id?: number | string },
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.roomsService.inviteExistingUser(Number(roomId), Number(body?.user_id), userId)
  }

  @Post(":room_id/knock-suggestions")
  async suggestKnock(
    @Param("room_id") roomId: string,
    @Body() body: { user_id?: number | string },
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.roomsService.suggestKnock(Number(roomId), Number(body?.user_id), userId)
  }

  @Post(":room_id/member-invitations/:invitation_id/accept")
  async acceptMemberInvitation(
    @Param("room_id") roomId: string,
    @Param("invitation_id") invitationId: string,
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.roomsService.acceptMemberInvitation(Number(roomId), Number(invitationId), userId)
  }

  @Patch(":room_id/member-invitations/:invitation_id")
  async reviewMemberInvitation(
    @Param("room_id") roomId: string,
    @Param("invitation_id") invitationId: string,
    @Body() body: StatusBody,
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.roomsService.reviewMemberInvitation(Number(roomId), Number(invitationId), userId, body?.status as never)
  }

  @Get(":room_id/knocks")
  async knocks(@Param("room_id") roomId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.roomsService.listKnocks(Number(roomId), userId)
  }

  @Post(":room_id/knocks")
  async knock(@Param("room_id") roomId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.roomsService.knock(Number(roomId), userId)
  }

  @Patch(":room_id/knocks/:knock_id")
  async reviewKnock(
    @Param("room_id") roomId: string,
    @Param("knock_id") knockId: string,
    @Body() body: StatusBody,
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.roomsService.reviewKnock(Number(roomId), Number(knockId), userId, body?.status as never)
  }

  @Get(":room_id/chat/messages")
  @Header("Cache-Control", "private, no-store")
  async chatMessages(
    @Param("room_id") roomId: string,
    @Query("before") before: string | undefined,
    @Query("after") after: string | undefined,
    @Query("limit") limit: string | undefined,
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.chatService.listMessages(Number(roomId), userId, {
      before: before ? Number(before) : undefined,
      after: after === undefined ? undefined : Number(after),
      limit: limit ? Number(limit) : undefined,
    })
  }

  @Get(":room_id/chat/people")
  async chatPeople(
    @Param("room_id") roomId: string,
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.chatService.listPeopleMessages(Number(roomId), userId)
  }

  @Get(":room_id/chat/rounds")
  async chatActivities(@Param("room_id") roomId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.chatService.listActivities(Number(roomId), userId)
  }

  @Post(":room_id/chat/drafts")
  async createChatDraft(
    @Param("room_id") roomId: string,
    @Body() body: { client_nonce?: unknown },
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.chatService.createDraftMessage(Number(roomId), userId, { clientNonce: body?.client_nonce })
  }

  @Delete(":room_id/chat/drafts/:message_id")
  async deleteChatDraft(
    @Param("room_id") roomId: string,
    @Param("message_id") messageId: string,
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.chatService.deleteDraftMessage(Number(roomId), Number(messageId), userId)
  }

  @Post(":room_id/chat/messages/seen")
  async markChatMessagesSeen(@Param("room_id") roomId: string, @Req() request: Request, @Body() body: { messageIds?: unknown }) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    await this.chatService.markMessagesSeen(Number(roomId), userId, body?.messageIds)
  }

  @Post(":room_id/chat/messages")
  async sendChatMessage(
    @Param("room_id") roomId: string,
    @Body() body: { body?: unknown; content?: unknown; client_nonce?: unknown; draft_id?: unknown },
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.chatService.sendMessage(Number(roomId), userId, {
      body: body.body,
      content: body.content,
      clientNonce: body.client_nonce,
      draftId: body.draft_id,
    })
  }

  @Get(":room_id/chat/messages/:message_id")
  async chatMessage(
    @Param("room_id") roomId: string,
    @Param("message_id") messageId: string,
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.chatService.message(Number(roomId), Number(messageId), userId)
  }

  @Get(":room_id/chat/messages/:message_id/replies")
  async chatReplies(
    @Param("room_id") roomId: string,
    @Param("message_id") messageId: string,
    @Req() request: Request,
    @Query("after") after?: string,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.repliesService.listForChatMessage(Number(roomId), Number(messageId), userId, after === undefined ? undefined : Number(after))
  }

  @Post(":room_id/chat/messages/:message_id/replies/seen")
  async markChatRepliesSeen(@Param("room_id") roomId: string, @Param("message_id") messageId: string,
    @Req() request: Request, @Body() body: { replyIds?: unknown }) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    await this.repliesService.markChatRepliesSeen(Number(roomId), Number(messageId), userId, body?.replyIds)
  }

  @Post(":room_id/chat/messages/:message_id/replies")
  async createChatReply(
    @Param("room_id") roomId: string,
    @Param("message_id") messageId: string,
    @Body() body: { reply?: { content?: unknown; status?: string; link_preview?: unknown } },
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.repliesService.createForChatMessage(
      Number(roomId),
      Number(messageId),
      userId,
      body?.reply ?? {},
    )
  }

  @Patch(":room_id/chat/messages/:message_id/replies/:reply_id")
  async updateChatReply(
    @Param("room_id") roomId: string,
    @Param("message_id") messageId: string,
    @Param("reply_id") replyId: string,
    @Body() body: { reply?: { content?: unknown; status?: string; link_preview?: unknown } },
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.repliesService.updateForChatMessage(
      Number(roomId),
      Number(messageId),
      Number(replyId),
      userId,
      body?.reply ?? {},
    )
  }

  @Post(":room_id/chat/messages/:message_id/replies/:reply_id/publish")
  async publishChatReply(
    @Param("room_id") roomId: string,
    @Param("message_id") messageId: string,
    @Param("reply_id") replyId: string,
    @Body() body: { reply?: { content?: unknown; link_preview?: unknown } },
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.repliesService.publishForChatMessage(
      Number(roomId),
      Number(messageId),
      Number(replyId),
      userId,
      body?.reply ?? {},
    )
  }

  @Post(":room_id/chat/entry-links")
  async linkPostToChat(
    @Param("room_id") roomId: string,
    @Body() body: { entry_id?: unknown; client_nonce?: unknown },
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.chatService.linkPostToChat(Number(roomId), Number(body.entry_id), userId, body.client_nonce)
  }

  @Post(":room_id/chat/messages/:message_id/save-entry")
  async saveChatMessageAsPost(
    @Param("room_id") roomId: string,
    @Param("message_id") messageId: string,
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.chatService.saveMessageAsPost(Number(roomId), Number(messageId), userId)
  }

  @Post(":room_id/chat/messages/:message_id/copy-note")
  async copyChatMessageToNote(
    @Param("room_id") roomId: string,
    @Param("message_id") messageId: string,
    @Body() body: { note_id?: unknown; idempotency_key?: unknown } | undefined,
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    const noteId = body?.note_id === undefined ? undefined : Number(body.note_id)
    return this.chatService.copyMessageToNote(
      Number(roomId),
      Number(messageId),
      userId,
      new Date(),
      noteId,
      body?.idempotency_key,
    )
  }

  @Post(":room_id/chat/messages/:message_id/request-save")
  async requestChatMessageSave(
    @Param("room_id") roomId: string,
    @Param("message_id") messageId: string,
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.chatService.requestMessageSave(Number(roomId), Number(messageId), userId)
  }

  @Delete(":room_id/members/:membershipId")
  async removeMember(@Param("room_id") roomId: string, @Param("membershipId") membershipId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return this.roomsService.removeMember(Number(roomId), userId ?? 0, Number(membershipId))
  }

  @Delete(":room_id")
  async deleteRoom(@Param("room_id") roomId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return this.roomsService.deleteRoom(Number(roomId), userId ?? 0)
  }

  @Get(":room_id/notification-deliveries")
  async notificationDeliveries(@Param("room_id") roomId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return this.roomsService.listNotificationDeliveries(Number(roomId), userId ?? 0)
  }

  @Get(":room_id/first-entry-prompts")
  async firstPostPrompts(@Param("room_id") roomId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return serializeFirstEntryPrompts(await this.communityBannersService.listFirstPostPrompts(Number(roomId), userId ?? 0))
  }


  @Post()
  @UseInterceptors(FileInterceptor("room[avatar]", IMAGE_MULTIPART_OPTIONS))
  async create(@Req() request: Request, @Body() body: RoomBody, @UploadedFile() file?: Express.Multer.File) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    const circlePayload = body.room ?? {}
    const payload = await this.roomsService.createRoom(userId, {
      name: this.readString(circlePayload.name, body["room[name]"]),
      porosity: this.readString(circlePayload.porosity, body["room[porosity]"]),
      avatarFile: file,
    })
    return serializeRoom(payload)
  }

  @Patch(":room_id")
  @UseInterceptors(FileInterceptor("room[avatar]", IMAGE_MULTIPART_OPTIONS))
  async update(
    @Param("room_id") roomId: string,
    @Req() request: Request,
    @Body() body: RoomBody,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    const circlePayload = body.room ?? {}
    const removeAvatarRaw = circlePayload.remove_avatar ?? body["room[remove_avatar]"] ?? body["room[remove_avatar]"]
    const payload = await this.roomsService.updateRoom(Number(roomId), userId, {
      name: this.readString(circlePayload.name, body["room[name]"]),
      porosity: this.readString(circlePayload.porosity, body["room[porosity]"]),
      avatarFile: file,
      removeAvatar: this.readBoolean(removeAvatarRaw),
    })
    return serializeRoom(payload)
  }

  @Patch(":room_id/first-entry-prompts")
  async updateFirstPostPrompts(@Param("room_id") roomId: string, @Req() request: Request, @Body() body: FirstEntryPromptsBody) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    const payload = await this.communityBannersService.updateFirstPostPrompts(Number(roomId), userId, {
      roomPrompt: body.room_prompt,
      memberPrompts: (body.member_prompts ?? []).map((item) => ({
        membershipId: Number(item.membership_id),
        prompt: item.prompt,
      })),
    })
    return serializeFirstEntryPrompts(payload)
  }

  @Get(":room_id/menu")
  async menu(@Param("room_id") roomId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return serializeSlideMenu(await this.navigationService.slideMenu(userId ?? 0, Number(roomId)))
  }

  private readString(...values: Array<string | undefined | null>) {
    for (const value of values) {
      if (typeof value === "string") return value
    }
    return undefined
  }

  private readBoolean(value: unknown) {
    if (typeof value === "boolean") return value
    if (typeof value === "string") return value === "true"
    return false
  }
}
