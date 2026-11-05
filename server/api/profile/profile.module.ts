import { Module } from "@nestjs/common"
import { AuthModule } from "../v1/auth/auth.module"
import { UploadsModule } from "../v1/uploads/uploads.module"
import { PrismaModule } from "../../prisma/prisma.module"
import { ProfileController } from "./profile.controller"
import { ProfileService } from "./profile.service"

@Module({
  imports: [AuthModule, PrismaModule, UploadsModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
