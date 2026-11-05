import { RoomAccessModule } from "../rooms/room-access.module"
import { Module } from "@nestjs/common"
import { AuthModule } from "../auth/auth.module"
import { NotificationsController } from "./notifications.controller"
import { NotificationsService } from "./notifications.service"
import { PrismaModule } from "../../../prisma/prisma.module"
import { NotificationInboxSerializer } from "../../../notifications/notification-inbox.serializer"

@Module({
  imports: [AuthModule, PrismaModule, RoomAccessModule],
  controllers: [NotificationsController],
  providers: [NotificationInboxSerializer, NotificationsService],
})
export class NotificationsModule {}
