import { Module } from "@nestjs/common"
import { PrismaModule } from "../prisma/prisma.module"
import { WorkerHealthService } from "./worker-health.service"

@Module({ imports: [PrismaModule], providers: [WorkerHealthService], exports: [WorkerHealthService] })
export class WorkerHealthModule {}
