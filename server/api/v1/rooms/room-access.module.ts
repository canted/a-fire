import { Module } from "@nestjs/common"
import { PrismaModule } from "../../../prisma/prisma.module"
import { RoomAccessService } from "./room-access.service"

@Module({ imports: [PrismaModule], providers: [RoomAccessService], exports: [RoomAccessService] })
export class RoomAccessModule {}
