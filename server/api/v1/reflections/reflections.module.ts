import { Module } from "@nestjs/common"
import { AuthModule } from "../auth/auth.module"
import { BossModule } from "../../../queue/boss.module"
import { RealtimeModule } from "../../../realtime/realtime.module"
import { ReflectionsController } from "./reflections.controller"
import { ReflectionsService } from "./reflections.service"

@Module({
  imports: [AuthModule, BossModule, RealtimeModule],
  controllers: [ReflectionsController],
  providers: [ReflectionsService],
})
export class ReflectionsModule {}
