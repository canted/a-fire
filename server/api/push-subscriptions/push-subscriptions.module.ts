import { Module } from "@nestjs/common"
import { AuthModule } from "../v1/auth/auth.module"
import { PushSubscriptionsController } from "./push-subscriptions.controller"
import { PushSubscriptionsService } from "./push-subscriptions.service"
import { PrismaModule } from "../../prisma/prisma.module"

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [PushSubscriptionsController],
  providers: [PushSubscriptionsService],
})
export class PushSubscriptionsModule {}
