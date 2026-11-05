import { describe, expect, it } from "vitest"
import { activityScope, roundRoomId } from "@server/api/v1/rounds/round-scope"

describe("Round Room ownership", () => {
  it("uses the explicit Room without loading another container", () => {
    expect(roundRoomId({ room_id: 7 })).toBe(7)
    expect(activityScope({ room_id: 7 })).toEqual({ room_id: 7 })
  })
  it.each([null, undefined])("does not invent ownership when the Room is %s", community_id => {
    expect(roundRoomId({ room_id: community_id })).toBeNull()
    expect(() => activityScope({ room_id: community_id ?? null })).toThrow("Round has no Room")
  })
})
