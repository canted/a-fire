import type { RoomAccessKind } from "../rooms/room-access.service"

/** Status visibility only; callers must first establish current Room access.
 * This never grants participation, exposes result contents, or renews a visit.
 */
export function canReadRoundStatus(status: string, kind: RoomAccessKind, limitedHistory: boolean): boolean {
  return kind === "member" || status === "active" || (!limitedHistory && status === "archived")
}
