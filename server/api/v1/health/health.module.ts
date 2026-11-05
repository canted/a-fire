import { WorkerHealthModule } from "../../../queue/worker-health.module"
import { Module } from "@nestjs/common"
import { HealthController } from "./health.controller"
import { HealthService } from "./health.service"

@Module({
  imports: [WorkerHealthModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
