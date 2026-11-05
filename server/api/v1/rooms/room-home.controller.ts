import { RoomsService } from "./rooms.service"
import type { UpdateRoomFeedbackSettingsInput } from "./room-feedback-settings"
import { Body, Controller, Get, Inject, Param, ParseIntPipe, Patch, Req, UseGuards } from "@nestjs/common"
import type { Request } from "express"
import { AuthGuard, type RequestWithUser } from "../auth/auth.guard"
import { BoardsDetailService } from "../boards/boards.detail.service"

/** Room identity owns this read; legacy Board routes adapt the same preview owner. */
@Controller("api/v1/rooms")
@UseGuards(AuthGuard)
export class RoomHomeController {
  @Inject(BoardsDetailService)
  private readonly detail!: BoardsDetailService

  @Inject(RoomsService)
  private readonly rooms!: RoomsService

  @Patch(":id/feedback-settings")
  updateFeedbackSettings(@Param("id", ParseIntPipe) id: number, @Req() request: Request, @Body() body: UpdateRoomFeedbackSettingsInput) {
    return this.rooms.updateFeedbackSettings(id, (request as RequestWithUser).user?.id ?? 0, body ?? {})
  }

  @Get(":id/home")
  home(@Param("id", ParseIntPipe) id: number, @Req() request: Request) {
    return this.detail.fetchRoomHome(id, (request as RequestWithUser).user?.id ?? 0)
  }
}
