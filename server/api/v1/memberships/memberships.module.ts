import { Module } from "@nestjs/common"
import { PrismaModule } from "../../../prisma/prisma.module"
import { AuthModule } from "../auth/auth.module"
import { UploadsModule } from "../uploads/uploads.module"
import { MembershipsController } from "./memberships.controller"
import { MembershipsService } from "./memberships.service"

@Module({
  imports: [AuthModule, PrismaModule, UploadsModule],
  controllers: [MembershipsController],
  providers: [MembershipsService],
})
export class MembershipsModule {}
