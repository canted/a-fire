import { Module } from "@nestjs/common"
import { PrismaModule } from "../../../prisma/prisma.module"
import { AuthModule } from "../auth/auth.module"
import { LinkPreviewsController } from "./link-previews.controller"
import { LinkPreviewsService } from "./link-previews.service"

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [LinkPreviewsController],
  providers: [LinkPreviewsService],
  exports: [LinkPreviewsService],
})
export class LinkPreviewsModule {}
