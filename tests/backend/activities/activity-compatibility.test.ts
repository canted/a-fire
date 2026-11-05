import "reflect-metadata"
import { PATH_METADATA } from "@nestjs/common/constants"
import { RoundsController } from "@server/api/v1/rounds/rounds.controller"
import { ACTIVITY_NOTIFICATION_QUEUE } from "@server/queue/queue-names"

it("exposes Room-owned Round lists and Round detail endpoints", () => {
  expect(Reflect.getMetadata(PATH_METADATA, RoundsController.prototype.show)).toBe("rounds/:roundId")
  expect(Reflect.getMetadata(PATH_METADATA, RoundsController.prototype.listForRoom)).toBe("rooms/:roomId/rounds")
})
it("keeps pending notifications on their existing persisted queue", () => {
  expect(ACTIVITY_NOTIFICATION_QUEUE).toBe("rounds.notification")
})
