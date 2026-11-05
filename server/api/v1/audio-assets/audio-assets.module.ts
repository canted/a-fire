import { BossModule } from "../../../queue/boss.module"
import { RoomAccessModule } from "../rooms/room-access.module";
import { Module } from "@nestjs/common"
import { PrismaModule } from "../../../prisma/prisma.module"
import { StorageModule } from "../../../storage/storage.module"
import { AuthModule } from "../auth/auth.module"
import { AudioAssetsController } from "./audio-assets.controller"
import { AudioAssetsService } from "./audio-assets.service"

@Module({
  imports: [BossModule, AuthModule, PrismaModule, StorageModule, RoomAccessModule],
  controllers: [AudioAssetsController],
  providers: [AudioAssetsService],
  exports: [AudioAssetsService],
})
export class AudioAssetsModule {}
