import { Controller, Get, Header, Headers, Inject, Param, Query, Req, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard"
import { MediaAuthGuard } from "../auth/media-auth.guard"
import { PRIVATE_MEDIA_CACHE_CONTROL } from "../../../storage/media-cache"
import type { MediaStreamPayload } from "../../../storage/media-range"
import { AudioAssetsService } from "./audio-assets.service"

@Controller("api/v1/audio-assets")
export class AudioAssetsController {
  @Inject(AudioAssetsService)
  private readonly audioAssetsService!: AudioAssetsService

  @Get(":id")
  @UseGuards(AuthGuard)
  async show(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    const asset = await this.audioAssetsService.getAudioAssetForUser(Number(id), request.user.id)
    const sourceContext = await this.audioAssetsService.getSourceContext(asset)

    return {
      id: asset.id,
      title: asset.title,
      processing_status: asset.processing_status,
      duration_ms: asset.duration_ms,
      created_at: asset.created_at.toISOString(),

      error_message: asset.error_message,
      filename: asset.blob.filename,
      content_type: asset.blob.content_type,
      reply_available: sourceContext.reply_available ?? true,
      source_type: sourceContext.source_type,
      source_id: sourceContext.source_id,
      parent_entry_id: sourceContext.parent_entry_id,
      parent_chat_message_id: sourceContext.parent_chat_message_id,
      room_id: sourceContext.room_id,
      playback_url: `/api/v1/audio-assets/${asset.id}/download`,
      download_url: `/api/v1/audio-assets/${asset.id}/download`,
    }
  }

  @Get(":id/spectrum")
  @UseGuards(AuthGuard)
  @Header("Cache-Control", PRIVATE_MEDIA_CACHE_CONTROL)
  @Header("Vary", "Authorization, Cookie")
  async spectrum(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.audioAssetsService.getSpectrumForUser(Number(id), request.user.id)
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
    const payload = await this.audioAssetsService.streamAudioAssetForUser(
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
