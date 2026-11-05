import "reflect-metadata"
import { MODULE_METADATA } from "@nestjs/common/constants"
import { BossModule } from "@server/queue/boss.module"
import { BossWorkerModule } from "@server/queue/boss-worker.module"
import { BossWorkers } from "@server/queue/boss.workers"

function providersFor(module: object): unknown[] {
  return Reflect.getMetadata(MODULE_METADATA.PROVIDERS, module) ?? []
}

describe("BossModule", () => {
  it("keeps worker registration out of the HTTP queue client module", () => {
    expect(providersFor(BossModule)).not.toContain(BossWorkers)
  })

  it("registers workers only in the worker module", () => {
    expect(providersFor(BossWorkerModule)).toContain(BossWorkers)
  })
})
