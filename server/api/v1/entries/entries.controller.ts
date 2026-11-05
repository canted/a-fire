import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common"
import { Request } from "express"
import { AuthGuard, RequestWithUser } from "../auth/auth.guard"
import { EntriesService, type EntryFeedbackRequestInput } from "./entries.service"

@Controller("api/v1")
@UseGuards(AuthGuard)
export class EntriesController {
  @Inject(EntriesService)
  private readonly postsService!: EntriesService

  @Get("entries")
  async index(@Query("roomId") roomId: string | undefined, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    const room = roomId === undefined ? null : Number(roomId)
    if (room !== null && (!Number.isSafeInteger(room) || room <= 0)) throw new BadRequestException("Invalid Room")
    return this.postsService.listPosts(room, userId ?? 0)
  }

  @Get("entries/:id")
  async show(@Param("id") id: string, @Query("page") page: string | undefined, @Query("per_page") perPage: string | undefined, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return this.postsService.fetchEntry(Number(id), userId ?? 0, page, perPage)
  }

  @Delete("entries/:id")
  async deleteLockedChatPost(@Param("id") id: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return this.postsService.deleteLockedChatPost(Number(id), userId ?? 0)
  }

  @Get("entries/:id/project-shares")
  roomProjectShares(@Param("id") id: string, @Query("cursor") cursor: string | undefined, @Req() request: Request) {
    if (cursor !== undefined && (!Number.isSafeInteger(Number(cursor)) || Number(cursor) <= 0)) throw new BadRequestException("Invalid cursor")
    return this.postsService.roomProjectShares(Number(id), (request as RequestWithUser).user?.id ?? 0, cursor ? Number(cursor) : undefined)
  }

  @Get("entries/:id/replies")
  async replies(@Param("id") id: string, @Query("page") page: string | undefined, @Query("per_page") perPage: string | undefined, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    const response = await this.postsService.fetchEntry(Number(id), userId ?? 0, page, perPage)
    return response.replies
  }

  @Patch("entries/:id/project")
  async updateProject(
    @Param("id") id: string,
    @Body() body: { project_id?: number | null },
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id
    return this.postsService.updateProject(Number(id), userId ?? 0, body.project_id ?? null)
  }

  @Patch("entries/:id/round")
  async updateRound(
    @Param("id") id: string,
    @Body() body: { round_id?: number | null },
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id
    return this.postsService.updateDraftActivity(Number(id), userId ?? 0, body.round_id ?? null)
  }

  @Get("entries/:id/draft")
  async fetchDraft(@Param("id") id: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return this.postsService.fetchDraft(Number(id), userId ?? 0)
  }

  @Put("entries/:id/content")
  async saveContent(
    @Param("id") id: string,
    @Body() body: {
      content?: unknown
      subject?: unknown
      link_preview?: unknown
      feedback_request?: EntryFeedbackRequestInput | null
      format?: unknown
      format_data?: unknown
      expected_revision?: unknown
    },
    @Req() request: Request,
  ) {
    if (typeof body.expected_revision !== "number" || !Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0) {
      throw new BadRequestException("Entry revision is required. Reload the editor before saving.")
    }
    const userId = (request as RequestWithUser).user?.id
    return this.postsService.saveContent(
      Number(id),
      userId ?? 0,
      body.content,
      body.subject,
      body.link_preview,
      body.feedback_request,
      body.format,
      body.format_data,
      body.expected_revision,
    )
  }

  @Post("entries/:id/publish")
  async publish(@Param("id") id: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return this.postsService.publish(Number(id), userId ?? 0)
  }

  @Post("entries/:id/withdraw")
  async withdraw(@Param("id") id: string, @Req() request: Request) {
    return this.postsService.withdrawRoomEntry(Number(id), (request as RequestWithUser).user?.id ?? 0)
  }

  @Patch("entries/:id/feedback-request")
  async updateFeedbackRequest(
    @Param("id") id: string,
    @Body() body: { feedback_request?: EntryFeedbackRequestInput },
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id
    return this.postsService.updateFeedbackRequest(Number(id), userId ?? 0, body.feedback_request ?? {})
  }
}
