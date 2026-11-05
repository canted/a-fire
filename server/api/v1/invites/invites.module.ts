import { BossModule } from "../../../queue/boss.module"
import { Module } from "@nestjs/common"
import { InvitesController } from "./invites.controller"
import { InvitesService } from "./invites.service"
import { AuthModule } from "../auth/auth.module"

@Module({
  imports: [AuthModule, BossModule],
  controllers: [InvitesController],
  providers: [InvitesService],
})
export class InvitesModule {}
