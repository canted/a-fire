import { Module } from "@nestjs/common"
import { AuthModule } from "../api/v1/auth/auth.module"
import { NotificationActivityModule } from "../notifications/notification-activity.module"
import { PrismaModule } from "../prisma/prisma.module"
import { RealtimeGateway } from "./realtime.gateway"
import { RealtimeService } from "./realtime.service"
import { HocuspocusService } from "./hocuspocus.service"
import { RoomsModule } from "../api/v1/rooms/rooms.module"

@Module({
  imports: [AuthModule, PrismaModule, NotificationActivityModule, RoomsModule],
  providers: [RealtimeService, RealtimeGateway, HocuspocusService],
  exports: [RealtimeService, HocuspocusService],
})
export class RealtimeModule {}
