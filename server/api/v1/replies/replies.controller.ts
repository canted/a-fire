import { BadRequestException, Body, Controller, Inject, Param, Patch, Post, Req, UseGuards } from "@nestjs/common"
import { Request } from "express"
import { AuthGuard, RequestWithUser } from "../auth/auth.guard"
import { RepliesService } from "./replies.service"

@Controller("api/v1")
@UseGuards(AuthGuard)
export class RepliesController {
  @Inject(RepliesService)
  private readonly repliesService!: RepliesService

  @Post("entries/:entryId/replies")
  async create(
    @Param("entryId") entryId: string,
    @Body() body: { reply?: { expected_revision?: unknown; content?: unknown; status?: string; link_preview?: unknown; feedback_type?: unknown } },
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id
    return this.repliesService.create(Number(entryId), userId ?? 0, body.reply ?? {})
  }

  @Patch("entries/:entryId/replies/:replyId")
  async update(
    @Param("entryId") entryId: string,
    @Param("replyId") replyId: string,
    @Body() body: { reply?: { expected_revision?: unknown; content?: unknown; status?: string; link_preview?: unknown; feedback_type?: unknown } },
    @Req() request: Request,
  ) {
    this.requireRevision(body.reply?.expected_revision)
    const userId = (request as RequestWithUser).user?.id
    return this.repliesService.update(Number(entryId), Number(replyId), userId ?? 0, body.reply ?? {})
  }

  @Post("entries/:entryId/replies/:replyId/publish")
  async publish(
    @Param("entryId") entryId: string,
    @Param("replyId") replyId: string,
    @Body() body: { reply?: { expected_revision?: unknown; content?: unknown; link_preview?: unknown; feedback_type?: unknown } },
    @Req() request: Request,
  ) {
    this.requireRevision(body.reply?.expected_revision)
    const userId = (request as RequestWithUser).user?.id
    return this.repliesService.publish(Number(entryId), Number(replyId), userId ?? 0, body.reply ?? {})
  }
  private requireRevision(value: unknown) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      throw new BadRequestException("Reply revision is required. Reload the editor before saving.")
    }
  }

}
