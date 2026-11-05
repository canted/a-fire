import { Global, Module } from "@nestjs/common"
import { PrismaModule } from "../prisma/prisma.module"
import { NotificationActivityService } from "./notification-activity.service"

@Global()
@Module({
  imports: [PrismaModule],
  providers: [NotificationActivityService],
  exports: [NotificationActivityService],
})
export class NotificationActivityModule {}
