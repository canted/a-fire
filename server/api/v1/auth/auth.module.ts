import { Module } from "@nestjs/common"
import { AuthController } from "./auth.controller"
import { AuthService } from "./auth.service"
import { AuthGuard } from "./auth.guard"
import { MediaAuthGuard } from "./media-auth.guard"
import { PrismaModule } from "../../../prisma/prisma.module"
import { MailerModule } from "../../../mailer/mailer.module"
import { NotificationActivityModule } from "../../../notifications/notification-activity.module"

@Module({
  imports: [PrismaModule, MailerModule, NotificationActivityModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, MediaAuthGuard],
  exports: [AuthService, AuthGuard, MediaAuthGuard],
})
export class AuthModule {}
