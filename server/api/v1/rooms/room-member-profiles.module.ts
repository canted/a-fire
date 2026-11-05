import { Module } from "@nestjs/common"
import { AuthModule } from "../auth/auth.module"
import { IntroductionsModule } from "../introductions/introductions.module"
import { ProjectsModule } from "../projects/projects.module"
import { RoomMemberProfilesController } from "./room-member-profiles.controller"
import { RoomMemberProfilesService } from "./room-member-profiles.service"
import { RoomsModule } from "./rooms.module"

@Module({
  imports: [AuthModule, IntroductionsModule, ProjectsModule, RoomsModule],
  controllers: [RoomMemberProfilesController],
  providers: [RoomMemberProfilesService],
})
export class RoomMemberProfilesModule {}
