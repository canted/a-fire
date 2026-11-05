import { RoomAccessModule } from "../../rooms/room-access.module"
import { Module } from "@nestjs/common"
import { PrismaModule } from "../../../../prisma/prisma.module"
import { BossModule } from "../../../../queue/boss.module"
import { RealtimeModule } from "../../../../realtime/realtime.module"
import { RoundLifecycleService } from "../round-lifecycle.service"
import { ArtBeforeChorusRoundService } from "./art-before-chorus.activity.service"
import { RoundRuntime } from "./round-runtime.registry"

@Module({
  imports: [PrismaModule, BossModule, RealtimeModule, RoomAccessModule],
  providers: [ArtBeforeChorusRoundService, RoundRuntime, RoundLifecycleService],
  exports: [RoundRuntime, RoundLifecycleService],
})
export class RoundRuntimeModule {}
