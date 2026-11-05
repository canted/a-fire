import { Body, Controller, Inject, Post, UseGuards } from "@nestjs/common"
import { AuthGuard } from "../auth/auth.guard"
import { LinkPreviewsService } from "./link-previews.service"

@Controller("api/v1/link-previews")
@UseGuards(AuthGuard)
export class LinkPreviewsController {
  @Inject(LinkPreviewsService)
  private readonly linkPreviews!: LinkPreviewsService

  @Post("resolve")
  async resolve(@Body() body: { url?: unknown }) {
    return this.linkPreviews.resolve(body.url)
  }
}
