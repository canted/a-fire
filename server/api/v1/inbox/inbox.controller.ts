import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common"
import { Request } from "express"
import { AuthGuard, RequestWithUser } from "../auth/auth.guard"
import { InboxService } from "./inbox.service"

@Controller("api/v1/inbox")
@UseGuards(AuthGuard)
export class InboxController {
  @Inject(InboxService)
  private readonly inboxService!: InboxService

  @Get()
  async inbox(@Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return this.inboxService.inbox(userId ?? 0)
  }
}
