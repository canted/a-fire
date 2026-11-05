import { Module } from "@nestjs/common"
import { PrismaModule } from "../../../prisma/prisma.module"
import { BossModule } from "../../../queue/boss.module"
import { RealtimeModule } from "../../../realtime/realtime.module"
import { AuthModule } from "../auth/auth.module"
import { RoomsModule } from "../rooms/rooms.module"
import { RoundNotificationsService } from "./round-notifications.service"
import { RoundsController } from "./rounds.controller"
import { RoundsService } from "./rounds.service"
import { RoundRuntimeModule } from "./runtime/round-templates.module"
import { WallsController } from "./walls.controller"
import { WallsService } from "./walls.service"

@Module({
  imports: [AuthModule, PrismaModule, BossModule, RoomsModule, RealtimeModule, RoundRuntimeModule],
  controllers: [RoundsController, WallsController],
  providers: [RoundNotificationsService, RoundsService, WallsService],
  exports: [RoundsService],
})
export class RoundsModule {}
