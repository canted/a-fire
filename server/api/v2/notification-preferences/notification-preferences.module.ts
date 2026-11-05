import { Module } from "@nestjs/common"
import { AuthModule } from "../../v1/auth/auth.module"
import { NotificationsDomainModule } from "../../../notifications/notifications.module"
import { V2NotificationPreferencesController } from "./notification-preferences.controller"

@Module({
  imports: [AuthModule, NotificationsDomainModule],
  controllers: [V2NotificationPreferencesController],
})
export class V2NotificationPreferencesModule {}
