import { Body, Controller, Get, Headers, Inject, Param, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common"
import { FileInterceptor } from "@nestjs/platform-express"
import { memoryStorage } from "multer"
import type { Response } from "express"
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard"
import { MediaAuthGuard } from "../auth/media-auth.guard"
import { setMediaAuthCookieFromAuthorization } from "../auth/media-auth-cookie"
import { mediaDisposition, PRIVATE_MEDIA_CACHE_CONTROL } from "../../../storage/media-cache"
import type { MediaStreamPayload } from "../../../storage/media-range"
import { UploadsService } from "./uploads.service"

type UploadBody = {
  entry_id?: string
  reply_id?: string
  page_id?: string
  note_id?: string
  chat_message_id?: string
  metadata?: string
  width?: string
  height?: string
}

type AttachBody = {
  record_type?: string
  record_id?: string
  name?: string
}

type VariantBody = {
  variation_digest?: string
}

const DEFAULT_CONTENT_UPLOAD_MAX_BYTES = 100 * 1024 * 1024

@Controller("api/v1/uploads")
export class UploadsController {
  @Inject(UploadsService)
  private readonly uploadsService!: UploadsService

  @Post()
  @UseGuards(AuthGuard)
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: contentUploadMaxBytes() } }))
  async create(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadBody,
  ) {
    setMediaAuthCookieFromAuthorization(response, request.headers.authorization)

    const payload = await this.uploadsService.createUpload(
      request.user.id,
      file,
      {
        entry_id: body.entry_id ? Number(body.entry_id) : undefined,
        reply_id: body.reply_id ? Number(body.reply_id) : undefined,
        note_id: body.note_id ? Number(body.note_id) : undefined,
        page_id: body.page_id ? Number(body.page_id) : undefined,
        chat_message_id: body.chat_message_id ? Number(body.chat_message_id) : undefined,
      },
      {
        metadata: body.metadata,
        width: body.width,
        height: body.height,
      },
    )

    await this.uploadsService.enqueuePostImageVariants(
      { id: payload.id, content_type: payload.content_type ?? null },
      {
        entry_id: body.entry_id ? Number(body.entry_id) : undefined,
        reply_id: body.reply_id ? Number(body.reply_id) : undefined,
        note_id: body.note_id ? Number(body.note_id) : undefined,
        page_id: body.page_id ? Number(body.page_id) : undefined,
        chat_message_id: body.chat_message_id ? Number(body.chat_message_id) : undefined,
      },
    )

    if ("audio_asset" in payload && payload.audio_asset) {
      return {
        success: 1,
        audio_asset: {
          id: payload.audio_asset.id,
          title: payload.audio_asset.title,
          processing_status: payload.audio_asset.processing_status,
          filename: payload.filename,
          content_type: payload.content_type,
          metadata_url: `/api/v1/audio-assets/${payload.audio_asset.id}`,
          playback_url: `/api/v1/audio-assets/${payload.audio_asset.id}/download`,
          download_url: `/api/v1/audio-assets/${payload.audio_asset.id}/download`,
        },
      }
    }

    if ("video_asset" in payload && payload.video_asset) {
      return {
        success: 1,
        video_asset: {
          id: payload.video_asset.id,
          title: payload.video_asset.title,
          processing_status: payload.video_asset.processing_status,
          duration_ms: payload.video_asset.duration_ms,
          width: payload.video_asset.width,
          height: payload.video_asset.height,
          filename: payload.filename,
          content_type: payload.content_type,
          metadata_url: `/api/v1/video-assets/${payload.video_asset.id}`,
          playback_url: `/api/v1/video-assets/${payload.video_asset.id}/download`,
          download_url: `/api/v1/video-assets/${payload.video_asset.id}/download`,
        },
      }
    }

    return {
      success: 1,
      file: {
        url: `/api/v1/uploads/${payload.id}`,
        signed_id: String(payload.id),
        filename: payload.filename,
        content_type: payload.content_type,
        byte_size: payload.byte_size,
        ...(payload.width && payload.height ? { width: payload.width, height: payload.height } : {}),
      },
    }
  }

  @Get(":id")
  @UseGuards(MediaAuthGuard)
  async show(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
    @Headers("range") range?: string,
    @Headers("if-none-match") ifNoneMatch?: string,
  ) {
    const payload = await this.uploadsService.streamUpload(Number(id), request.user.id, range, ifNoneMatch)
    setBasicPrivateMediaHeaders(response)
    if (payload.etag) response.setHeader("ETag", payload.etag)
    if ("notModified" in payload) return response.status(304).end()

    setStreamPrivateMediaHeaders(response, payload)
    response.setHeader("Content-Disposition", mediaDisposition(payload.filename, payload.contentType))
    payload.stream.pipe(response)
  }

  @Post(":id/attach")
  @UseGuards(AuthGuard)
  async attach(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: AttachBody) {
    if (!body.record_type || !body.record_id || !body.name) {
      return { success: 0, message: "record_type, record_id, and name are required" }
    }

    await this.uploadsService.attachUpload(request.user.id, Number(id), {
      record_type: body.record_type,
      record_id: Number(body.record_id),
      name: body.name,
    })

    return { success: 1 }
  }

  @Post(":id/variants")
  @UseGuards(AuthGuard)
  async createVariant(@Param("id") id: string, @Body() body: VariantBody, @Req() request: AuthenticatedRequest) {
    const payload = await this.uploadsService.requestVariant(Number(id), body.variation_digest ?? "", request.user.id)

    return {
      url: `/api/v1/uploads/${payload.blobId}/variants/${payload.variationDigest}`,
    }
  }

  @Get(":id/variants/:digest")
  @UseGuards(MediaAuthGuard)
  async showVariant(
    @Param("id") id: string,
    @Param("digest") digest: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
    @Headers("if-none-match") ifNoneMatch?: string,
  ) {
    const payload = await this.uploadsService.streamVariant(Number(id), digest, request.user.id, ifNoneMatch)

    setBasicPrivateMediaHeaders(response)
    response.setHeader("ETag", payload.etag)
    if ("notModified" in payload) return response.status(304).end()
    response.setHeader("Content-Type", payload.contentType)
    response.setHeader("Content-Length", payload.byteSize)
    response.setHeader("Content-Disposition", mediaDisposition(payload.filename, payload.contentType))
    payload.stream.pipe(response)
  }
}

function setBasicPrivateMediaHeaders(response: Response) {
  response.setHeader("Cache-Control", PRIVATE_MEDIA_CACHE_CONTROL)
  response.setHeader("Vary", "Authorization, Cookie")
  response.setHeader("X-Content-Type-Options", "nosniff")
  response.setHeader("Content-Security-Policy", "sandbox; default-src 'none'")
}

function setStreamPrivateMediaHeaders(response: Response, payload: MediaStreamPayload) {
  response.setHeader("Cache-Control", PRIVATE_MEDIA_CACHE_CONTROL)
  response.setHeader("Vary", "Authorization, Cookie")
  response.setHeader("X-Content-Type-Options", "nosniff")
  response.setHeader("Accept-Ranges", "bytes")
  response.setHeader("Content-Type", payload.contentType)
  if (payload.range) {
    response.status(206)
    response.setHeader("Content-Range", `bytes ${payload.range.start}-${payload.range.end}/${payload.range.total}`)
    response.setHeader("Content-Length", payload.range.end - payload.range.start + 1)
    return
  }
  response.setHeader("Content-Length", payload.byteSize)
}

function contentUploadMaxBytes() {
  const raw = Number(process.env.CONTENT_UPLOAD_MAX_BYTES ?? process.env.VIDEO_UPLOAD_MAX_BYTES)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CONTENT_UPLOAD_MAX_BYTES
}
