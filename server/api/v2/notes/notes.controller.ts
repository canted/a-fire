import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common"
import type { Request } from "express"
import { AuthGuard, RequestWithUser } from "../../v1/auth/auth.guard"
import { PagesService } from "../../v1/pages/pages.service"
import { PagesWriteService } from "../../v1/pages/pages.write.service"
import { serializeNotePayload, serializeNoteTree } from "../serializers"

type CreateNoteBody = {
  room_id?: number | string
  title?: string
  icon?: string
  parent_id?: number | string | null
  insert_parent_link?: boolean
}

@Controller("api/v2/notes")
@UseGuards(AuthGuard)
export class NotesController {
  @Inject(PagesService)
  private readonly pagesService!: PagesService

  @Inject(PagesWriteService)
  private readonly pagesWriteService!: PagesWriteService

  @Post()
  async create(@Body() body: CreateNoteBody, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    const roomId = body.room_id
    return serializeNotePayload(
      await this.pagesWriteService.createPage(userId ?? 0, {
        room_id: roomId ? Number(roomId) : undefined,
        title: body.title,
        icon: body.icon,
        parent_id: body.parent_id === null || body.parent_id === undefined ? null : Number(body.parent_id),
        insert_parent_link: body.insert_parent_link === true,
      }),
    )
  }

  @Get("tree")
  async tree(@Query("room_id") roomId: string | undefined, @Req() request: Request) {
    if (!roomId) throw new BadRequestException("room_id is required")
    const userId = (request as RequestWithUser).user?.id
    return serializeNoteTree(await this.pagesService.fetchTree(Number(roomId), userId ?? 0))
  }

  @Get(":note_id")
  async show(@Param("note_id") noteId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return serializeNotePayload(await this.pagesService.fetchPage(Number(noteId), userId ?? 0))
  }

  @Patch(":note_id")
  async update(
    @Param("note_id") noteId: string,
    @Body() body: { note?: { title?: string | null; icon?: string | null }; page?: { title?: string | null; icon?: string | null } },
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id
    return serializeNotePayload(await this.pagesWriteService.updatePage(Number(noteId), userId ?? 0, body.note ?? body.page ?? {}))
  }

  @Put(":note_id/content")
  async saveContent(@Param("note_id") noteId: string, @Body() body: { content?: unknown; expected_version?: unknown }, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    return serializeNotePayload(await this.pagesWriteService.saveContent(Number(noteId), userId ?? 0, body.content, body.expected_version))
  }

  @Post(":note_id/content/blocks")
  async prependContentBlocks(
    @Param("note_id") noteId: string,
    @Body() body: { blocks?: unknown; position?: "top" | "after_audio"; audio_asset_id?: unknown; audio_node_id?: unknown },
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id
    return serializeNotePayload(await this.pagesWriteService.prependContentBlocks(Number(noteId), userId ?? 0, body))
  }

  @Delete(":note_id")
  async destroy(@Param("note_id") noteId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    await this.pagesWriteService.deletePage(Number(noteId), userId ?? 0)
  }
}
