import { Module } from "@nestjs/common"
import { AuthModule } from "../../v1/auth/auth.module"
import { RealtimeModule } from "../../../realtime/realtime.module"
import { PagesService } from "../../v1/pages/pages.service"
import { PagesWriteService } from "../../v1/pages/pages.write.service"
import { NotesController } from "./notes.controller"

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [NotesController],
  providers: [PagesService, PagesWriteService],
})
export class V2NotesModule {}
