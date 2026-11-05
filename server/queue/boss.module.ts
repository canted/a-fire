import { Module } from "@nestjs/common"
import { BossService } from "./boss.service"

@Module({
  providers: [BossService],
  exports: [BossService],
})
export class BossModule {}
