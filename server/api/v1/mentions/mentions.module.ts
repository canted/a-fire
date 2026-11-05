import { RoomAccessModule } from "../rooms/room-access.module"
import { Module } from "@nestjs/common"
import { PrismaModule } from "../../../prisma/prisma.module"
import { AuthModule } from "../auth/auth.module"
import { MentionsController } from "./mentions.controller"
import { MentionsService } from "./mentions.service"

@Module({
  imports: [AuthModule, PrismaModule, RoomAccessModule],
  controllers: [MentionsController],
  providers: [MentionsService],
})
export class MentionsModule {}
