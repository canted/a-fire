import { Module } from "@nestjs/common"
import { AuthModule } from "../v1/auth/auth.module"
import { NotificationPreferencesController } from "./notification-preferences.controller"
import { NotificationsDomainModule } from "../../notifications/notifications.module"

@Module({
  imports: [AuthModule, NotificationsDomainModule],
  controllers: [NotificationPreferencesController],
})
export class NotificationPreferencesModule {}
