import { Module } from "@nestjs/common"
import { PrismaModule } from "../../../prisma/prisma.module"
import { BossModule } from "../../../queue/boss.module"
import { StorageModule } from "../../../storage/storage.module"
import { AuthModule } from "../auth/auth.module"
import { UploadsController } from "./uploads.controller"
import { UploadsService } from "./uploads.service"
import { ImagesModule } from "../../../uploads/images/images.module"
import { RoomAccessModule } from "../rooms/room-access.module"

@Module({
  imports: [AuthModule, PrismaModule, BossModule, StorageModule, ImagesModule, RoomAccessModule],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
