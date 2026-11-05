import { RoomAccessModule } from "../api/v1/rooms/room-access.module"
import { Module } from "@nestjs/common"
import { PrismaModule } from "../prisma/prisma.module"
import { RealtimeModule } from "../realtime/realtime.module"
import { NotificationDeliveryService } from "./notification-delivery.service"
import { NotificationInboxSerializer } from "./notification-inbox.serializer"
import { NotificationPreferencesService } from "./notification-preferences.service"
import { UnseenContentService } from "../api/v1/unseen/unseen-content.service"

@Module({
  imports: [PrismaModule, RealtimeModule, RoomAccessModule],
  providers: [NotificationDeliveryService, NotificationInboxSerializer, NotificationPreferencesService, UnseenContentService],
  exports: [NotificationDeliveryService, NotificationPreferencesService],
})
export class NotificationsDomainModule {}
