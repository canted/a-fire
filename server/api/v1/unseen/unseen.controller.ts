import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common"
import { Request } from "express"
import { AuthGuard, RequestWithUser } from "../auth/auth.guard"
import { MarkEntrySeenInput, UnseenContentService } from "./unseen-content.service"

@Controller("api/v1")
@UseGuards(AuthGuard)
export class UnseenController {
  @Inject(UnseenContentService)
  private readonly unseenContent!: UnseenContentService

  @Get("unseen/count")
  async count(@Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return this.unseenContent.countForUser(userId ?? 0)
  }

  @Post("unseen/seen-all")
  async markAllSeen(@Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return this.unseenContent.markAllSeen(userId ?? 0)
  }

  @Post("entries/:entryId/seen")
  async markPostSeen(
    @Param("entryId") entryId: string,
    @Body() body: MarkEntrySeenInput,
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id
    return this.unseenContent.markPostSeen(userId ?? 0, Number(entryId), body ?? {})
  }
}
