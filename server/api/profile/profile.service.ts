import { identityImageUrl } from "../v1/uploads/identity-images"
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "../../prisma/prisma.service"
import { UploadsService } from "../v1/uploads/uploads.service"
import { userAvatarUrl } from "../v1/uploads/upload-urls"

export type IdentityPayload = {
  id: number
  username: string
  profile_line: string | null
  avatar_url: string | null
}

type UpdateIdentityInput = {
  username?: string
  profileLine?: string | null
  avatarFile?: Express.Multer.File
  removeAvatar?: boolean
}

@Injectable()
export class ProfileService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(UploadsService)
  private readonly uploadsService!: UploadsService

  async updateIdentity(userId: number, input: UpdateIdentityInput): Promise<IdentityPayload> {
    if (!userId) throw new NotFoundException("Not Found")

    const user = await this.prisma.user.findUnique({ where: { id: this.toId(userId) } })
    if (!user) throw new NotFoundException("Not Found")

    const data: { username?: string; profile_line?: string | null; updated_at: Date } = {
      updated_at: new Date(),
    }
    if (input.username !== undefined) {
      const username = input.username.trim()
      if (!username) throw new BadRequestException("username is required")
      data.username = username
    }
    if (input.profileLine !== undefined) {
      data.profile_line = input.profileLine
    }
    const updated =
      input.username !== undefined || input.profileLine !== undefined
        ? await this.prisma.user.update({ where: { id: user.id }, data })
        : user

    if (input.removeAvatar) {
      await this.uploadsService.removeAttachment(userId, {
        record_type: "User",
        record_id: userId,
        name: "avatar",
      })
    }

    let avatarUrl: string | null = null
    if (input.avatarFile) {
      const blob = await this.uploadsService.createAttachmentUpload(userId, input.avatarFile, {
        record_type: "User",
        record_id: userId,
        name: "avatar",
      })
      avatarUrl = userAvatarUrl(`/api/v1/uploads/${String(blob.id)}`)
    } else {
      avatarUrl = await identityImageUrl(this.prisma, "User", userId)
    }

    return {
      id: this.toId(user.id),
      username: updated.username,
      profile_line: updated.profile_line ?? null,
      avatar_url: avatarUrl,
    }
  }

  private toId(value: number | string | null | undefined): number {
    if (value === null || value === undefined) return 0
    return typeof value === "number" ? value : Number(value)
  }
}
