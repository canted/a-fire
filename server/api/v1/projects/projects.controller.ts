import { HomeService } from "./home.service"
import {
  Body,
  Controller,
  BadRequestException,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common"
import { FileFieldsInterceptor } from "@nestjs/platform-express"
import { IMAGE_MULTIPART_OPTIONS } from "../../../uploads/images/image-policy"
import { Request } from "express"
import { AuthGuard, RequestWithUser } from "../auth/auth.guard"
import { ProjectsService } from "./projects.service"
import { ProjectEntriesService, type ProjectEntryInput, type ProjectShareInput } from "./project-entries.service"

type ProjectBody = {
  request_key?: string
  icon_symbol?: string
  icon_color?: string
  name?: string
  description?: string | null
  room_ids?: number[] | string[] | string
  remove_icon?: string | boolean
  remove_banner?: string | boolean
  project?: {
    request_key?: string
    icon_symbol?: string
    icon_color?: string
    name?: string
    description?: string | null
    room_ids?: number[] | string[] | string
    remove_icon?: string | boolean
    remove_banner?: string | boolean
  }
  "project[request_key]"?: string
  "project[icon_symbol]"?: string
  "project[icon_color]"?: string
  "project[name]"?: string
  "project[description]"?: string
  "project[room_ids][]"?: string[] | string
  "project[remove_icon]"?: string
  "project[remove_banner]"?: string
}

@Controller("api/v1/projects")
@UseGuards(AuthGuard)
export class ProjectsController {
  @Inject(ProjectsService)
  private readonly projects!: ProjectsService

  @Inject(ProjectEntriesService)
  private readonly entries!: ProjectEntriesService

  @Inject(HomeService) private readonly home!: HomeService

  @Get("home")
  homeSnapshot(@Req() request: Request, @Query("timezone") timezone?: string, @Query("round") activity?: string, @Query("activity_cursor") activityCursor?: string) {
    return this.home.snapshot(this.userId(request), timezone, activity === "true", activityCursor)
  }

  @Get()
  listMine(@Req() request: Request, @Query("room_id") roomId?: string, @Query("cursor") cursor?: string) {
    return this.projects.listMine(this.userId(request), roomId ? this.id(roomId) : undefined, cursor)
  }

  @Get(":id")
  show(@Param("id") id: string, @Req() request: Request) {
    return this.projects.show(this.id(id), this.userId(request))
  }

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "project[icon]", maxCount: 1 },
        { name: "project[banner]", maxCount: 1 },
      ],
      IMAGE_MULTIPART_OPTIONS,
    ),
  )
  create(
    @Req() request: Request,
    @Body() body: ProjectBody,
    @UploadedFiles() files?: Record<string, Express.Multer.File[]>,
  ) {
    const project = body.project ?? {}
    return this.projects.create(this.userId(request), {
      requestKey: project.request_key ?? body["project[request_key]"] ?? body.request_key,
      iconSymbol: project.icon_symbol ?? body["project[icon_symbol]"] ?? body.icon_symbol,
      iconColor: project.icon_color ?? body["project[icon_color]"] ?? body.icon_color,
      name: project.name ?? body["project[name]"] ?? body.name,
      description: project.description ?? body["project[description]"] ?? body.description,
      roomIds: this.roomIds(project.room_ids ?? body["project[room_ids][]"] ?? body.room_ids),
      iconFile: files?.["project[icon]"]?.[0],
      bannerFile: files?.["project[banner]"]?.[0],
    })
  }

  @Patch(":id")
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "project[icon]", maxCount: 1 },
        { name: "project[banner]", maxCount: 1 },
      ],
      IMAGE_MULTIPART_OPTIONS,
    ),
  )
  update(
    @Param("id") id: string,
    @Req() request: Request,
    @Body() body: ProjectBody,
    @UploadedFiles() files?: Record<string, Express.Multer.File[]>,
  ) {
    const project = body.project ?? {}
    return this.projects.update(this.id(id), this.userId(request), {
      iconSymbol: project.icon_symbol ?? body["project[icon_symbol]"] ?? body.icon_symbol,
      iconColor: project.icon_color ?? body["project[icon_color]"] ?? body.icon_color,
      name: project.name ?? body["project[name]"] ?? body.name,
      description: project.description ?? body["project[description]"] ?? body.description,
      roomIds: this.roomIds(project.room_ids ?? body["project[room_ids][]"] ?? body.room_ids),
      iconFile: files?.["project[icon]"]?.[0],
      bannerFile: files?.["project[banner]"]?.[0],
      removeIcon: this.boolean(project.remove_icon ?? body["project[remove_icon]"] ?? body.remove_icon),
      removeBanner: this.boolean(project.remove_banner ?? body["project[remove_banner]"] ?? body.remove_banner),
    })
  }

  @Post(":id/invitations")
  invite(@Param("id") id: string, @Body() body: { username?: string }, @Req() request: Request) {
    return this.projects.invite(this.id(id), this.userId(request), body.username ?? "")
  }

  @Post(":id/participation/accept")
  accept(@Param("id") id: string, @Req() request: Request) {
    return this.projects.accept(this.id(id), this.userId(request))
  }

  @Post(":id/participation/decline")
  decline(@Param("id") id: string, @Req() request: Request) {
    return this.projects.decline(this.id(id), this.userId(request))
  }

  @Delete(":id/participants/:participantId")
  removeParticipant(@Param("id") id: string, @Param("participantId") participantId: string, @Req() request: Request) {
    return this.projects.removeParticipant(this.id(id), this.userId(request), this.id(participantId))
  }

  @Get(":id/entries")
  entryPage(@Param("id") id: string, @Req() request: Request, @Query("cursor") cursor?: string, @Query("entry_id") entryId?: string) {
    return this.entries.page(this.id(id), this.userId(request), cursor, entryId === undefined ? undefined : this.id(entryId))
  }

  @Post(":id/entries")
  createEntry(@Param("id") id: string, @Req() request: Request, @Body() body: { fresh?: unknown; request_key?: unknown } = {}) {
    return this.entries.create(this.id(id), this.userId(request), body)
  }

  @Get(":id/entries/:entryId")
  showEntry(@Param("id") id: string, @Param("entryId") entryId: string, @Req() request: Request) {
    return this.entries.show(this.id(id), this.id(entryId), this.userId(request))
  }

  @Get(":id/entries/:entryId/copies")
  entryCopies(@Param("id") id: string, @Param("entryId") entryId: string, @Req() request: Request, @Query("cursor") cursor?: string) {
    return this.entries.copies(this.id(id), this.id(entryId), this.userId(request), cursor)
  }

  @Patch(":id/entries/:entryId")
  updateEntry(@Param("id") id: string, @Param("entryId") entryId: string, @Body() body: ProjectEntryInput, @Req() request: Request) {
    return this.entries.update(this.id(id), this.id(entryId), this.userId(request), body)
  }

  @Patch(":id/entries/:entryId/project")
  moveEntry(@Param("id") id: string, @Param("entryId") entryId: string, @Body() body: { project_id: number; expected_revision: unknown }, @Req() request: Request) {
    if (!Number.isSafeInteger(body.project_id) || body.project_id <= 0) throw new BadRequestException("Choose a project")
    return this.entries.changeLocation(this.id(id), this.id(entryId), this.userId(request), body.expected_revision, body.project_id)
  }

  @Delete(":id/entries/:entryId")
  deleteEntry(@Param("id") id: string, @Param("entryId") entryId: string, @Query("revision") revision: string, @Req() request: Request) {
    return this.entries.changeLocation(this.id(id), this.id(entryId), this.userId(request), revision ? Number(revision) : undefined, null)
  }

  @Get(":id/entries/:entryId/share-selection")
  shareSelection(@Param("id") id: string, @Param("entryId") entryId: string, @Query("room_id") roomId: string, @Req() request: Request) {
    return this.entries.shareSelection(this.id(id), this.id(entryId), this.userId(request), this.id(roomId))
  }

  @Get(":id/entries/:entryId/share-request/:requestKey")
  findShare(@Param("id") id: string, @Param("entryId") entryId: string, @Param("requestKey") key: string, @Req() request: Request) {
    return this.entries.findShare(this.id(id), this.id(entryId), this.userId(request), key)
  }

  @Post(":id/entries/:entryId/share-draft")
  shareDraft(@Param("id") id: string, @Param("entryId") entryId: string, @Body() body: ProjectShareInput, @Req() request: Request) {
    return this.entries.shareDraft(this.id(id), this.id(entryId), this.userId(request), body)
  }

  @Get(":id/reply-keeps/:entryId")
  replyKeeps(@Param("id") id: string, @Param("entryId") entryId: string, @Req() request: Request) {
    return this.entries.replyKeeps(this.id(id), this.userId(request), this.id(entryId))
  }

  @Post(":id/reply-keeps/:entryId")
  toggleReplyKeep(@Param("id") id: string, @Param("entryId") entryId: string, @Body() body: { reply_ids: number[]; saved: boolean }, @Req() request: Request) {
    return this.entries.toggleReplyKeep(this.id(id), this.userId(request), this.id(entryId), body.reply_ids, body.saved)
  }

  @Post(":id/keep")
  keep(@Param("id") id: string, @Body() body: { reply_id?: number; chat_message_id?: number }, @Req() request: Request) {
    if ((body.reply_id !== undefined) === (body.chat_message_id !== undefined)) throw new BadRequestException("Choose one feedback reply or chat message")
    return body.chat_message_id !== undefined
      ? this.entries.keepChatMessage(this.id(id), this.userId(request), this.id(body.chat_message_id))
      : this.entries.keep(this.id(id), this.userId(request), this.id(body.reply_id))
  }

  private userId(request: Request) {
    return (request as RequestWithUser).user?.id ?? 0
  }

  private boolean(value: string | boolean | undefined) {
    return value === true || value === "true" || value === "1"
  }

  private roomIds(value: number[] | string[] | string | undefined) {
    if (value === undefined) return undefined
    const values = Array.isArray(value) ? value : [value]
    return values.map((id) => this.id(id))
  }

  private id(value: unknown) {
    const id = Number(value)
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestException("Invalid identifier")
    return id
  }
}
