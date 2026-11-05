import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common"
import { FileInterceptor } from "@nestjs/platform-express"
import { IMAGE_MULTIPART_OPTIONS } from "../../../uploads/images/image-policy"
import { AuthGuard, RequestWithUser } from "../auth/auth.guard"
import { RoomsService } from "./rooms.service"
import { Request } from "express"
import { NavigationService } from "../navigation/navigation.service"
import { RoomBannersService } from "./room-banners.service"
import { LegacyApiDeprecationInterceptor } from "../../legacy-api-deprecation.interceptor"

type RoomBody = {
  room?: {
    name?: string
    porosity?: string | null
    remove_avatar?: string | boolean
  }
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

@Controller("api/v1/rooms")
@UseGuards(AuthGuard)
@UseInterceptors(new LegacyApiDeprecationInterceptor())
export class RoomsController {
  @Inject(RoomsService)
  private readonly roomsService!: RoomsService
  @Inject(NavigationService)
  private readonly navigationService!: NavigationService
  @Inject(RoomBannersService)
  private readonly communityBannersService!: RoomBannersService

  @Get(":id")
  async show(@Param("id") id: string, @Req() request: Request): Promise<ReturnType<RoomsService["fetchRoom"]>> {
    const userId = (request as RequestWithUser).user?.id
    return this.roomsService.fetchRoom(Number(id), userId ?? 0)
  }

  @Get(":id/members")
  async members(@Param("id") id: string, @Req() request: Request): Promise<ReturnType<RoomsService["listMembers"]>> {
    const userId = (request as RequestWithUser).user?.id
    return this.roomsService.listMembers(Number(id), userId ?? 0)
  }

  @Delete(":id/members/:membershipId")
  async removeMember(
    @Param("id") id: string,
    @Param("membershipId") membershipId: string,
    @Req() request: Request,
  ): Promise<ReturnType<RoomsService["removeMember"]>> {
    const userId = (request as RequestWithUser).user?.id
    return this.roomsService.removeMember(Number(id), userId ?? 0, Number(membershipId))
  }

  @Get(":id/first-entry-prompts")
  async firstPostPrompts(
    @Param("id") id: string,
    @Req() request: Request,
  ): Promise<ReturnType<RoomBannersService["listFirstPostPrompts"]>> {
    const userId = (request as RequestWithUser).user?.id
    return this.communityBannersService.listFirstPostPrompts(Number(id), userId ?? 0)
  }

  @Post()
  @UseInterceptors(FileInterceptor("room[avatar]", IMAGE_MULTIPART_OPTIONS))
  async create(
    @Req() request: Request,
    @Body() body: RoomBody,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<ReturnType<RoomsService["createRoom"]>> {
    const userId = (request as RequestWithUser).user?.id ?? 0
    const communityPayload = body.room ?? {}
    return this.roomsService.createRoom(userId, {
      name: this.readString(communityPayload.name, body["room[name]"]),
      porosity: this.readString(communityPayload.porosity, body["room[porosity]"]),
      avatarFile: file,
    })
  }

  @Patch(":id")
  @UseInterceptors(FileInterceptor("room[avatar]", IMAGE_MULTIPART_OPTIONS))
  async update(
    @Param("id") id: string,
    @Req() request: Request,
    @Body() body: RoomBody,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<ReturnType<RoomsService["updateRoom"]>> {
    const userId = (request as RequestWithUser).user?.id ?? 0
    const communityPayload = body.room ?? {}
    const removeAvatarRaw = communityPayload.remove_avatar ?? body["room[remove_avatar]"]
    return this.roomsService.updateRoom(Number(id), userId, {
      name: this.readString(communityPayload.name, body["room[name]"]),
      porosity: this.readString(communityPayload.porosity, body["room[porosity]"]),
      avatarFile: file,
      removeAvatar: this.readBoolean(removeAvatarRaw),
    })
  }

  @Patch(":id/first-entry-prompts")
  async updateFirstPostPrompts(
    @Param("id") id: string,
    @Req() request: Request,
    @Body() body: FirstEntryPromptsBody,
  ): Promise<ReturnType<RoomBannersService["updateFirstPostPrompts"]>> {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.communityBannersService.updateFirstPostPrompts(Number(id), userId, {
      roomPrompt: body.room_prompt,
      memberPrompts: (body.member_prompts ?? []).map((item) => ({
        membershipId: Number(item.membership_id),
        prompt: item.prompt,
      })),
    })
  }

  @Get(":id/menu")
  async menu(@Param("id") id: string, @Req() request: Request): Promise<ReturnType<NavigationService["slideMenu"]>> {
    const userId = (request as RequestWithUser).user?.id
    return this.navigationService.slideMenu(userId ?? 0, Number(id))
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
