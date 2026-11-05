import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common"
import { Request } from "express"
import { AuthGuard, RequestWithUser } from "../auth/auth.guard"
import { IntroductionsService } from "./introductions.service"

@Controller("api/v1/introductions")
@UseGuards(AuthGuard)
export class IntroductionsController {
  @Inject(IntroductionsService)
  private readonly introductionsService!: IntroductionsService

  @Get("rooms/:roomId/pairs")
  async createdPairs(@Param("roomId") roomId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return this.introductionsService.listCreatedPairs(userId ?? 0, Number(roomId))
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return this.introductionsService.create(userId ?? 0, body as Record<string, unknown>)
  }

  @Post(":id/hide")
  async hide(@Param("id") id: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return this.introductionsService.hide(userId ?? 0, Number(id))
  }

  @Post("seen")
  async markSeen(@Body() body: { introduction_ids?: unknown }, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return this.introductionsService.markSeen(userId ?? 0, body?.introduction_ids)
  }

  @Post(":id/retract")
  async retract(@Param("id") id: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return this.introductionsService.retract(userId ?? 0, Number(id))
  }
}
