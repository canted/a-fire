type Door = "open" | "masked" | "closed"
type ParentAccess = { kind: "member" | "visitor"; room: { porosity: Door } }

/** Adjacency grants discovery/admission eligibility, never membership or ownership. */
export function roomDoorEligibility(parent: ParentAccess, childDoor: Door): "visit" | "knock" | "hidden" {
  const parentDoor = parent.kind === "member" ? "open" : parent.room.porosity
  if (parentDoor === "open") return childDoor === "closed" ? "knock" : "visit"
  if (parentDoor === "masked") return childDoor === "open" ? "visit" : childDoor === "masked" ? "knock" : "hidden"
  return childDoor === "open" ? "knock" : "hidden"
}

/** Membership and Open visits expose available history; Ajar/Closed visits are limited. */
export function hasLimitedRoomHistory(access: ParentAccess): boolean {
  return access.kind === "visitor" && access.room.porosity !== "open"
}
