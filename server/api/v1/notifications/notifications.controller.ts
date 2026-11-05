import { Body, Controller, Get, Inject, Post, Query, Req, UseGuards } from "@nestjs/common"
import { Request } from "express"
import { AuthGuard, RequestWithUser } from "../auth/auth.guard"
import { NotificationsService } from "./notifications.service"

@Controller("api/v1/notices")
@UseGuards(AuthGuard)
export class NotificationsController {
  @Inject(NotificationsService)
  private readonly notificationsService!: NotificationsService

  @Get()
  async inbox(
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id
    const parsed = limit ? Number(limit) : undefined
    const parsedCursor = cursor === undefined ? undefined : Number(cursor)
    return this.notificationsService.inbox(userId ?? 0, parsed, parsedCursor)
  }

  @Post("seen")
  async markSeen(@Body() body: { noticeIds?: unknown }, @Req() request: Request): Promise<void> {
    const userId = (request as RequestWithUser).user?.id
    await this.notificationsService.markNoticesSeen(userId ?? 0, body?.noticeIds)
  }

  @Post("seen-through")
  async markSeenThrough(@Body() body: { seenThroughAt?: string }, @Req() request: Request): Promise<void> {
    const userId = (request as RequestWithUser).user?.id
    await this.notificationsService.markSeenThrough(userId ?? 0, body.seenThroughAt ?? "")
  }
}
