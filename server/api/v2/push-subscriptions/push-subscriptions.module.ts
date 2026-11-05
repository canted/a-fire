import { Module } from "@nestjs/common"
import { AuthModule } from "../../v1/auth/auth.module"
import { PrismaModule } from "../../../prisma/prisma.module"
import { PushSubscriptionsService } from "../../push-subscriptions/push-subscriptions.service"
import { V2PushSubscriptionsController } from "./push-subscriptions.controller"

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [V2PushSubscriptionsController],
  providers: [PushSubscriptionsService],
})
export class V2PushSubscriptionsModule {}
