import { Module } from "@nestjs/common"
import { AuthModule } from "../auth/auth.module"
import { BossModule } from "../../../queue/boss.module"
import { RealtimeModule } from "../../../realtime/realtime.module"
import { LinkPreviewsModule } from "../link-previews/link-previews.module"
import { RoomAccessModule } from "../rooms/room-access.module"
import { RepliesController } from "./replies.controller"
import { RepliesService } from "./replies.service"

@Module({
  imports: [AuthModule, BossModule, RealtimeModule, LinkPreviewsModule, RoomAccessModule],
  controllers: [RepliesController],
  providers: [RepliesService],
  exports: [RepliesService],
})
export class RepliesModule {}
