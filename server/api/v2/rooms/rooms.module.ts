import { Module } from "@nestjs/common"
import { AuthModule } from "../../v1/auth/auth.module"
import { PrismaModule } from "../../../prisma/prisma.module"
import { UploadsModule } from "../../v1/uploads/uploads.module"
import { RoomsModule } from "../../v1/rooms/rooms.module"
import { BoardsModule } from "../../v1/boards/boards.module"
import { RoomsController } from "./rooms.controller"
import { RealtimeModule } from "../../../realtime/realtime.module"
import { ChatService } from "./chat.service"
import { PagesModule } from "../../v1/pages/pages.module"
import { BossModule } from "../../../queue/boss.module"
import { RepliesModule } from "../../v1/replies/replies.module"
import { RoundRuntimeModule } from "../../v1/rounds/runtime/round-templates.module"

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    UploadsModule,
    RoomsModule,
    BoardsModule,
    RealtimeModule,
    PagesModule,
    BossModule,
    RepliesModule,
    RoundRuntimeModule,
  ],
  controllers: [RoomsController],
  providers: [ChatService],
})
export class V2RoomsModule {}
