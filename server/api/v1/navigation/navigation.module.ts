import { Module } from "@nestjs/common"
import { AuthModule } from "../auth/auth.module"
import { NavigationController } from "./navigation.controller"
import { NavigationService } from "./navigation.service"
import { PrismaModule } from "../../../prisma/prisma.module"

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [NavigationController],
  providers: [NavigationService],
})
export class NavigationModule {}
