import { WorkerHealthService } from "../../../queue/worker-health.service"
import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common"
import { HealthService } from "./health.service"

@Controller("api/v1/health")
export class HealthController {
  @Inject(HealthService)
  private readonly healthService!: HealthService

  @Inject(WorkerHealthService)
  private readonly workerHealth!: WorkerHealthService

  @Get("workers")
  async workers() {
    const workers = await this.workerHealth.status()
    if (workers !== "ok") throw new ServiceUnavailableException({ status: "degraded", workers })
    return { status: "ok", workers }
  }

  @Get()
  async status(): Promise<{ status: string; db: string; vapid: string }> {
    return this.healthService.check()
  }

  @Get("live")
  live(): { status: "ok" } {
    return this.healthService.live()
  }
}
