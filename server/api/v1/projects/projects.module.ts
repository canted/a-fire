import { HomeService } from "./home.service"
import { UnseenModule } from "../unseen/unseen.module"
import { Module } from "@nestjs/common"
import { AuthModule } from "../auth/auth.module"
import { UploadsModule } from "../uploads/uploads.module"
import { RoomAccessModule } from "../rooms/room-access.module"
import { RoundsModule } from "../rounds/rounds.module"
import { ProjectEntriesService } from "./project-entries.service"
import { ProjectsController } from "./projects.controller"
import { ProjectsService } from "./projects.service"

@Module({
  imports: [AuthModule, UploadsModule, RoomAccessModule, RoundsModule, UnseenModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectEntriesService, HomeService],
  exports: [ProjectsService, ProjectEntriesService],
})
export class ProjectsModule {}
