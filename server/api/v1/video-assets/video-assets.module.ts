import { Module } from "@nestjs/common"
import { PrismaModule } from "../../../prisma/prisma.module"
import { StorageModule } from "../../../storage/storage.module"
import { AuthModule } from "../auth/auth.module"
import { VideoAssetsController } from "./video-assets.controller"
import { VideoAssetsService } from "./video-assets.service"
import { RoomAccessModule } from "../rooms/room-access.module"

@Module({
  imports: [AuthModule, PrismaModule, StorageModule, RoomAccessModule],
  controllers: [VideoAssetsController],
  providers: [VideoAssetsService],
  exports: [VideoAssetsService],
})
export class VideoAssetsModule {}
