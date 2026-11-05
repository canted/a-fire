import { RoomHomeController } from "../rooms/room-home.controller"
import { Module } from "@nestjs/common"
import { BoardsDetailService } from "./boards.detail.service"
import { AuthModule } from "../auth/auth.module"
import { PrismaModule } from "../../../prisma/prisma.module"
import { UploadsModule } from "../uploads/uploads.module"
import { RoomsModule } from "../rooms/rooms.module"
import { RoundRuntimeModule } from "../rounds/runtime/round-templates.module"

@Module({
  imports: [AuthModule, PrismaModule, UploadsModule, RoomsModule, RoundRuntimeModule],
  controllers: [RoomHomeController],
  providers: [BoardsDetailService],
  exports: [BoardsDetailService],
})
export class BoardsModule {}
