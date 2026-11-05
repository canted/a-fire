import { UploadsModule } from "../uploads/uploads.module"
import { Module } from "@nestjs/common"
import { BossModule } from "../../../queue/boss.module"
import { RealtimeModule } from "../../../realtime/realtime.module"
import { AuthModule } from "../auth/auth.module"
import { RoomsModule } from "../rooms/rooms.module"
import { LinkPreviewsModule } from "../link-previews/link-previews.module"
import { ProjectsModule } from "../projects/projects.module"
import { RoundsModule } from "../rounds/rounds.module"
import { EntryNotificationsService } from "./entry-notifications.service"
import { EntriesController } from "./entries.controller"
import { EntriesReadService } from "./entries.read.service"
import { EntriesService } from "./entries.service"

@Module({
  imports: [UploadsModule, AuthModule, BossModule, RealtimeModule, LinkPreviewsModule, RoundsModule, ProjectsModule, RoomsModule],
  controllers: [EntriesController],
  providers: [EntriesReadService, EntryNotificationsService, EntriesService],
  exports: [EntriesService],
})
export class EntriesModule {}
