import { Module } from "@nestjs/common"
import { PrismaModule } from "../../../prisma/prisma.module"
import { AuthModule } from "../auth/auth.module"
import { InboxController } from "./inbox.controller"
import { InboxService } from "./inbox.service"

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [InboxController],
  providers: [InboxService],
})
export class InboxModule {}
