import { Module } from "@nestjs/common"
import { PagesController } from "./pages.controller"
import { PagesService } from "./pages.service"
import { PagesWriteService } from "./pages.write.service"
import { AuthModule } from "../auth/auth.module"
import { RealtimeModule } from "../../../realtime/realtime.module"

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [PagesController],
  providers: [PagesService, PagesWriteService],
  exports: [PagesWriteService],
})
export class PagesModule {}
