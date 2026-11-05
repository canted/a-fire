import { Module } from "@nestjs/common"
import { AuthModule } from "../auth/auth.module"
import { PrismaModule } from "../../../prisma/prisma.module"
import { BossModule } from "../../../queue/boss.module"
import { IntroductionsController } from "./introductions.controller"
import { IntroductionsService } from "./introductions.service"

@Module({
  imports: [AuthModule, PrismaModule, BossModule],
  controllers: [IntroductionsController],
  providers: [IntroductionsService],
  exports: [IntroductionsService],
})
export class IntroductionsModule {}
