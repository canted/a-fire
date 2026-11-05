import { BadRequestException, Controller, Get, Inject, Query, Req, UseGuards } from "@nestjs/common"
import { Request } from "express"
import { AuthGuard, RequestWithUser } from "../auth/auth.guard"
import { MentionTargetsPayload, MentionsService } from "./mentions.service"

@Controller("api/v1/mentions")
@UseGuards(AuthGuard)
export class MentionsController {
  @Inject(MentionsService)
  private readonly mentionsService!: MentionsService

  @Get()
  async index(
    @Query("room_id") roomId: string | undefined,
    @Req() request: Request,
  ): Promise<MentionTargetsPayload> {
    if (!roomId) throw new BadRequestException("room_id is required")
    const parsedRoomId = Number(roomId)
    if (!Number.isFinite(parsedRoomId)) throw new BadRequestException("room_id is invalid")

    const userId = (request as RequestWithUser).user?.id
    return this.mentionsService.listTargets(parsedRoomId, userId ?? 0)
  }
}
