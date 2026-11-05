import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req, UseGuards, UseInterceptors } from "@nestjs/common"
import { Request } from "express"
import { LegacyApiDeprecationInterceptor } from "../../legacy-api-deprecation.interceptor"
import { AuthGuard, RequestWithUser } from "../auth/auth.guard"
import { PagesService } from "./pages.service"
import { PagesWriteService } from "./pages.write.service"

@Controller("api/v1/pages")
@UseGuards(AuthGuard)
@UseInterceptors(new LegacyApiDeprecationInterceptor())
export class PagesController {
  @Inject(PagesService)
  private readonly pagesService!: PagesService

  @Inject(PagesWriteService)
  private readonly pagesWriteService!: PagesWriteService

  @Post()
  async create(
    @Body() body: { room_id?: number; title?: string; icon?: string; parent_id?: number | null; insert_parent_link?: boolean },
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id
    return this.pagesWriteService.createPage(userId ?? 0, body)
  }

  @Get("tree")
  async tree(@Query("room_id") roomId: string | undefined, @Req() request: Request) {
    if (!roomId) throw new BadRequestException("room_id is required")
    const userId = (request as RequestWithUser).user?.id
    return this.pagesService.fetchTree(Number(roomId), userId ?? 0)
  }

  @Get(":id")
  async show(@Param("id") id: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return this.pagesService.fetchPage(Number(id), userId ?? 0)
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: { page?: { title?: string | null; icon?: string | null } }, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return this.pagesWriteService.updatePage(Number(id), userId ?? 0, body.page ?? {})
  }

  @Put(":id/content")
  async saveContent(@Param("id") id: string, @Body() body: { content?: unknown; expected_version?: unknown }, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return this.pagesWriteService.saveContent(Number(id), userId ?? 0, body.content, body.expected_version)
  }

  @Post(":id/content/blocks")
  async prependContentBlocks(
    @Param("id") id: string,
    @Body() body: { blocks?: unknown; position?: "top" | "after_audio"; audio_asset_id?: unknown; audio_node_id?: unknown },
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id
    return this.pagesWriteService.prependContentBlocks(Number(id), userId ?? 0, body)
  }

  @Delete(":id")
  async destroy(@Param("id") id: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    await this.pagesWriteService.deletePage(Number(id), userId ?? 0)
  }
}
