import { Module } from "@nestjs/common"
import { AuthModule } from "../../v1/auth/auth.module"
import { PrismaModule } from "../../../prisma/prisma.module"
import { UploadsModule } from "../../v1/uploads/uploads.module"
import { ProfileService } from "../../profile/profile.service"
import { V2ProfileController } from "./profile.controller"

@Module({
  imports: [AuthModule, PrismaModule, UploadsModule],
  controllers: [V2ProfileController],
  providers: [ProfileService],
})
export class V2ProfileModule {}
