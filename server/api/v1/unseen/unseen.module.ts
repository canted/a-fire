import { Module } from "@nestjs/common"
import { RoomAccessModule } from "../rooms/room-access.module"
import { AuthModule } from "../auth/auth.module"
import { UnseenController } from "./unseen.controller"
import { UnseenContentService } from "./unseen-content.service"
import { NotificationInboxSerializer } from "../../../notifications/notification-inbox.serializer"

@Module({
  imports: [AuthModule, RoomAccessModule],
  controllers: [UnseenController],
  providers: [UnseenContentService, NotificationInboxSerializer],
  exports: [UnseenContentService],
})
export class UnseenModule {}
