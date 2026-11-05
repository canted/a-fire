import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common"
import { FileInterceptor } from "@nestjs/platform-express"
import { IMAGE_MULTIPART_OPTIONS } from "../../../uploads/images/image-policy"
import { AuthGuard, RequestWithUser } from "../auth/auth.guard"
import { MembershipsService, MembershipIndexResponse, MembershipPayload } from "./memberships.service"
import { Request } from "express"

type MembershipBody = {
  membership?: {
    username_override?: string | null
    profile_line_override?: string | null
    notify?: string | boolean
    remove_avatar?: string | boolean
  }
  "membership[username_override]"?: string
  "membership[profile_line_override]"?: string
  "membership[notify]"?: string
  "membership[remove_avatar]"?: string
}

@Controller("api/v1/memberships")
@UseGuards(AuthGuard)
export class MembershipsController {
  @Inject(MembershipsService)
  private readonly membershipsService!: MembershipsService

  @Get()
  async index(@Req() request: Request): Promise<MembershipIndexResponse> {
    const userId = (request as RequestWithUser).user?.id
    return this.membershipsService.list(userId ?? 0)
  }

  @Patch(":id")
  @UseInterceptors(FileInterceptor("membership[avatar]", IMAGE_MULTIPART_OPTIONS))
  async update(
    @Param("id") id: string,
    @Body() body: MembershipBody = {},
    @Req() request: Request,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<MembershipPayload> {
    const userId = (request as RequestWithUser).user?.id ?? 0
    const membershipId = Number(id)
    const membershipPayload = body.membership ?? {}

    const usernameOverride =
      typeof membershipPayload.username_override === "string"
        ? this.readNullableString(membershipPayload.username_override)
        : membershipPayload.username_override === null
          ? null
          : this.readNullableString(body["membership[username_override]"])
    const profileLineOverride =
      typeof membershipPayload.profile_line_override === "string"
        ? this.readNullableString(membershipPayload.profile_line_override)
        : membershipPayload.profile_line_override === null
          ? null
          : this.readNullableString(body["membership[profile_line_override]"])
    const notifyRaw = membershipPayload.notify
    const notify = typeof notifyRaw === "string" ? notifyRaw === "true" : typeof notifyRaw === "boolean" ? notifyRaw : undefined
    const removeAvatarRaw = membershipPayload.remove_avatar ?? body["membership[remove_avatar]"]

    return this.membershipsService.update(userId, membershipId, {
      username_override: usernameOverride,
      profile_line_override: profileLineOverride,
      notify,
      avatarFile: file,
      removeAvatar: this.readBoolean(removeAvatarRaw),
    })
  }

  @Post(":id/disable")
  async disable(@Param("id") id: string, @Req() request: Request): Promise<MembershipPayload> {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.membershipsService.disable(userId, Number(id))
  }

  @Post(":id/enable")
  async enable(@Param("id") id: string, @Req() request: Request): Promise<MembershipPayload> {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.membershipsService.enable(userId, Number(id))
  }

  private readNullableString(value: string | undefined | null) {
    if (typeof value !== "string") return undefined
    const trimmed = value.trim()
    return trimmed || null
  }

  private readBoolean(value: unknown) {
    if (typeof value === "boolean") return value
    if (typeof value === "string") return value === "true"
    return false
  }
}
