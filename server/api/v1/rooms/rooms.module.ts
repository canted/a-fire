import { Module } from "@nestjs/common"
import { PrismaModule } from "../../../prisma/prisma.module"
import { BossModule } from "../../../queue/boss.module"
import { AuthModule } from "../auth/auth.module"
import { NavigationService } from "../navigation/navigation.service"
import { UploadsModule } from "../uploads/uploads.module"
import { RoomAccessModule } from "./room-access.module"
import { RoomRelationshipsService } from "./room-relationships.service"
import { RoomsController } from "./rooms.controller"
import { RoomsService } from "./rooms.service"
import { RoomBannersService } from "./room-banners.service"
import { RoomNotificationDeliveriesService } from "./room-notification-deliveries.service"

@Module({
  imports: [AuthModule, PrismaModule, UploadsModule, BossModule, RoomAccessModule],
  controllers: [RoomsController],
  providers: [RoomRelationshipsService, RoomNotificationDeliveriesService, RoomsService, RoomBannersService, NavigationService],
  exports: [RoomsService, RoomBannersService, NavigationService, RoomAccessModule],
})
export class RoomsModule {}
