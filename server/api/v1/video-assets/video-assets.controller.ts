import { Controller, Get, Headers, Inject, Param, Query, Req, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import { PRIVATE_MEDIA_CACHE_CONTROL, mediaDisposition } from "../../../storage/media-cache"
import type { MediaStreamPayload } from "../../../storage/media-range"
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard"
import { MediaAuthGuard } from "../auth/media-auth.guard"
import { VideoAssetsService } from "./video-assets.service"

@Controller("api/v1/video-assets")
export class VideoAssetsController {
  @Inject(VideoAssetsService)
  private readonly videoAssetsService!: VideoAssetsService

  @Get(":id")
  @UseGuards(AuthGuard)
  async show(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    const asset = await this.videoAssetsService.getVideoAssetForUser(Number(id), request.user.id)
    const sourceContext = await this.videoAssetsService.getSourceContext(asset)
    const posterUrl = await this.videoAssetsService.getPosterUrlForAsset(asset)

    return {
      id: asset.id,
      title: asset.title,
      processing_status: asset.processing_status,
      duration_ms: asset.duration_ms,
      width: asset.width,
      height: asset.height,
      error_message: asset.error_message,
      filename: asset.blob.filename,
      content_type: asset.blob.content_type,
      source_type: sourceContext.source_type,
      source_id: sourceContext.source_id,
      parent_entry_id: sourceContext.parent_entry_id,
      parent_chat_message_id: sourceContext.parent_chat_message_id,
      room_id: sourceContext.room_id,
      poster_url: posterUrl,
      playback_url: `/api/v1/video-assets/${asset.id}/download`,
      download_url: `/api/v1/video-assets/${asset.id}/download`,
    }
  }

  @Get(":id/download")
  @UseGuards(MediaAuthGuard)
  async download(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
    @Query("download") download?: string,
    @Headers("range") range?: string,
  ) {
    const payload = await this.videoAssetsService.streamVideoAssetForUser(
      Number(id),
      request.user.id,
      range,
    )

    setPrivateMediaHeaders(response, payload)
    response.setHeader(
      "Content-Disposition",
      `${download === "1" ? "attachment" : "inline"}; filename="${payload.filename}"`,
    )
    payload.stream.pipe(response)
  }

  @Get(":id/poster")
  @UseGuards(MediaAuthGuard)
  async poster(@Param("id") id: string, @Req() request: AuthenticatedRequest, @Res() response: Response, @Headers("if-none-match") ifNoneMatch?: string) {
    const payload = await this.videoAssetsService.streamVideoPosterForUser(
      Number(id),
      request.user.id,
      ifNoneMatch,
    )
    response.setHeader("Cache-Control", PRIVATE_MEDIA_CACHE_CONTROL)
    response.setHeader("Vary", "Authorization, Cookie")
    response.setHeader("ETag", payload.etag!)
    if ("notModified" in payload) { response.status(304).end(); return }
    setPrivateMediaHeaders(response, payload)
    response.setHeader("Content-Disposition", mediaDisposition(payload.filename, payload.contentType))
    payload.stream.pipe(response)
  }
}

function setPrivateMediaHeaders(response: Response, payload: MediaStreamPayload) {
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
