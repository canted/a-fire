import { Body, Controller, Inject, Patch, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common"
import { FileInterceptor } from "@nestjs/platform-express"
import { IMAGE_MULTIPART_OPTIONS } from "../../../uploads/images/image-policy"
import type { Request } from "express"
import { AuthGuard, RequestWithUser } from "../../v1/auth/auth.guard"
import { ProfileService, type IdentityPayload } from "../../profile/profile.service"

type ProfileBody = {
  profile?: {
    username?: string
    profile_line?: string | null
    remove_avatar?: string | boolean
  }
  "profile[username]"?: string
  "profile[profile_line]"?: string
  "profile[remove_avatar]"?: string
}

@Controller("api/v2/profile")
@UseGuards(AuthGuard)
export class V2ProfileController {
  @Inject(ProfileService)
  private readonly profileService!: ProfileService

  @Patch("avatar")
  @UseInterceptors(FileInterceptor("profile[avatar]", IMAGE_MULTIPART_OPTIONS))
  async updateAvatar(
    @Req() request: Request,
    @Body() body: ProfileBody,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<IdentityPayload> {
    const userId = (request as RequestWithUser).user?.id ?? 0
    const profilePayload = body.profile ?? {}
    const username = this.readString(profilePayload.username, body["profile[username]"])
    const profileLine = this.readNullableString(profilePayload.profile_line, body["profile[profile_line]"])
    const removeAvatarRaw = profilePayload.remove_avatar ?? body["profile[remove_avatar]"]

    return this.profileService.updateIdentity(userId, {
      username,
      profileLine,
      avatarFile: file,
      removeAvatar: this.readBoolean(removeAvatarRaw),
    })
  }

  private readString(...values: Array<string | undefined | null>) {
    for (const value of values) {
      if (typeof value === "string") return value
    }
    return undefined
  }

  private readNullableString(...values: Array<string | null | undefined>) {
    for (const value of values) {
      if (value === null) return null
      if (typeof value === "string") return value.trim() || null
    }
    return undefined
  }

  private readBoolean(value: unknown) {
    if (typeof value === "boolean") return value
    if (typeof value === "string") return value === "true"
    return false
  }
}
