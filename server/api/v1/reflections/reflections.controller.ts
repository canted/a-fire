import { Body, Controller, Delete, Inject, Param, Post, Req, UseGuards } from "@nestjs/common"
import { Request } from "express"
import { AuthGuard, RequestWithUser } from "../auth/auth.guard"
import { ReflectionsService } from "./reflections.service"

@Controller("api/v1")
@UseGuards(AuthGuard)
export class ReflectionsController {
  @Inject(ReflectionsService)
  private readonly reflectionsService!: ReflectionsService

  @Post("entries/:entryId/reflections")
  async createForPost(
    @Param("entryId") entryId: string,
    @Body() body: { page_id?: number },
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id
    return {
      reflections: await this.reflectionsService.createForPost(Number(entryId), userId ?? 0, Number(body.page_id)),
    }
  }

  @Delete("entries/:entryId/reflections/:pageId")
  async deleteForPost(@Param("entryId") entryId: string, @Param("pageId") pageId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return {
      reflections: await this.reflectionsService.deleteForPost(Number(entryId), userId ?? 0, Number(pageId)),
    }
  }

  @Post("replies/:replyId/reflections")
  async createForReply(
    @Param("replyId") replyId: string,
    @Body() body: { page_id?: number },
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id
    return {
      reflections: await this.reflectionsService.createForReply(Number(replyId), userId ?? 0, Number(body.page_id)),
    }
  }

  @Delete("replies/:replyId/reflections/:pageId")
  async deleteForReply(@Param("replyId") replyId: string, @Param("pageId") pageId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return {
      reflections: await this.reflectionsService.deleteForReply(Number(replyId), userId ?? 0, Number(pageId)),
    }
  }
}
