import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { vi } from "vitest"

type CircleRow = { id: number; parent_id: number | null; porosity: string; owner_id: number | null }

function makeService(circles: CircleRow[], memberships: Array<{ room_id: number; user_id: number }> = []) {
  const prisma = {
    room: {
      findUnique: vi.fn(({ where }: { where: { id: number } }) =>
        Promise.resolve(circles.find((circle) => circle.id === where.id) ?? null),
      ),
    },
    roomMembership: {
      findFirst: vi.fn(({ where }: { where: { room_id: number; user_id: number } }) =>
        Promise.resolve(
          memberships.find(
            (membership) =>
              membership.room_id === where.room_id && membership.user_id === where.user_id,
          ) ?? null,
        ),
      ),
    },
    roomVisit: { findFirst: vi.fn().mockResolvedValue({ source: "knock" }) },
    roomKnock: { findUnique: vi.fn().mockResolvedValue(null) },
    roomMemberInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
  }
  const service = new RoomAccessService()
  Object.assign(service as object, { prisma })
  return { service, prisma }
}

describe("CircleAccessService", () => {
  it("recognizes direct membership as full circle access", async () => {
    const { service } = makeService(
      [{ id: 2, parent_id: 1, porosity: "closed", owner_id: 7 }],
      [{ room_id: 2, user_id: 7 }],
    )

    await expect(service.resolve(2, 7)).resolves.toEqual(
      expect.objectContaining({ kind: "member", canViewNotes: true, canWriteWall: true }),
    )
  })

  it("lets a parent member visit open and masked children but not a closed child without admission", async () => {
    const circles = [
      { id: 1, parent_id: null, porosity: "closed", owner_id: 1 },
      { id: 2, parent_id: 1, porosity: "open", owner_id: 2 },
      { id: 3, parent_id: 1, porosity: "masked", owner_id: 3 },
      { id: 4, parent_id: 1, porosity: "closed", owner_id: 4 },
    ]
    const { service } = makeService(circles, [{ room_id: 1, user_id: 9 }])

    await expect(service.resolve(2, 9)).resolves.toEqual(expect.objectContaining({ kind: "visitor" }))
    await expect(service.resolve(3, 9)).resolves.toEqual(expect.objectContaining({ kind: "visitor" }))
    await expect(service.resolve(4, 9)).resolves.toBeNull()
  })

  it("lets an Open-parent visitor enter Open and Ajar children", async () => {
    const circles = [
      { id: 1, parent_id: null, porosity: "open", owner_id: 1 },
      { id: 2, parent_id: 1, porosity: "open", owner_id: 2 },
      { id: 3, parent_id: 2, porosity: "open", owner_id: 3 },
      { id: 4, parent_id: 2, porosity: "masked", owner_id: 4 },
    ]
    const { service } = makeService(circles, [{ room_id: 1, user_id: 9 }])

    await expect(service.resolve(3, 9)).resolves.toEqual(expect.objectContaining({ kind: "visitor" }))
    await expect(service.resolve(4, 9)).resolves.toEqual(expect.objectContaining({ kind: "visitor" }))
  })

  it("honors an admitted knock with a live lease until it is revoked", async () => {
    const { service, prisma } = makeService([
      { id: 1, parent_id: null, porosity: "open", owner_id: 1 },
      { id: 2, parent_id: 1, porosity: "closed", owner_id: 2 },
    ], [{ room_id: 1, user_id: 9 }])
    prisma.roomKnock.findUnique.mockResolvedValue({ status: "admitted" })

    await expect(service.resolve(2, 9)).resolves.toEqual(expect.objectContaining({ kind: "visitor", source: "knock" }))

    prisma.roomKnock.findUnique.mockResolvedValue({ status: "revoked" })
    await expect(service.resolve(2, 9)).resolves.toBeNull()
  })

  it("does not grant a visit from a pending membership invitation", async () => {
    const { service, prisma } = makeService([
      { id: 2, parent_id: 1, porosity: "closed", owner_id: 2 },
    ])
    prisma.roomMemberInvitation.findUnique.mockResolvedValue({ status: "pending" })

    await expect(service.resolve(2, 9)).resolves.toBeNull()
  })

  it("fails closed when corrupt parent data contains a cycle", async () => {
    const { service } = makeService([
      { id: 1, parent_id: 2, porosity: "open", owner_id: 1 },
      { id: 2, parent_id: 1, porosity: "open", owner_id: 2 },
    ])

    await expect(service.resolve(1, 9)).resolves.toBeNull()
  })
})


const doors = ["open", "masked", "closed"] as const
const expected = [["visit", "visit", "knock"], ["visit", "knock", "hidden"], ["knock", "hidden", "hidden"]]
it.each(doors.flatMap((parent, row) => doors.map((child, column) => ({ parent, child, action: expected[row][column] }))))("applies visitor adjacency for $parent parent / $child child", async ({ parent, child, action }) => {
  const { service, prisma } = makeService([
    { id: 1, parent_id: null, porosity: parent, owner_id: 1 },
    { id: 2, parent_id: 1, porosity: child, owner_id: 2 },
  ])
  prisma.roomKnock.findUnique.mockImplementation(async ({ where }) => where.room_id_user_id.room_id === 1 ? { status: "admitted" } : null)
  const result = await service.resolve(2, 9)
  if (action === "visit") expect(result).toMatchObject({ kind: "visitor", source: "porosity" })
  else expect(result).toBeNull()
})

it("revokes parent-derived admission when parent access is lost while retaining direct child membership", async () => {
  const memberships = [{ room_id: 1, user_id: 9 }]
  const { service, prisma } = makeService([
    { id: 1, parent_id: null, porosity: "open", owner_id: 1 },
    { id: 2, parent_id: 1, porosity: "closed", owner_id: 2 },
  ], memberships)
  prisma.roomKnock.findUnique.mockImplementation(async ({ where }) => where.room_id_user_id.room_id === 2 ? { status: "admitted" } : null)
  expect(await service.resolve(2, 9)).toMatchObject({ kind: "visitor" })
  memberships.splice(0)
  expect(await service.resolve(2, 9)).toBeNull()
  memberships.push({ room_id: 2, user_id: 9 })
  expect(await service.resolve(2, 9)).toMatchObject({ kind: "member" })
})


it("separates free admission eligibility from active visitor access without renewing reads", async () => {
  const { service, prisma } = makeService([
    { id: 1, parent_id: null, porosity: "closed", owner_id: 1 },
    { id: 2, parent_id: 1, porosity: "open", owner_id: 2 },
  ], [{ room_id: 1, user_id: 9 }])
  prisma.roomVisit.findFirst.mockResolvedValue(null)
  expect(await service.resolve(2, 9)).toBeNull()
  expect(await service.resolveAdmission(2, 9)).toMatchObject({ kind: "visitor", source: "porosity" })
  expect(prisma.roomVisit.findFirst).toHaveBeenCalledWith({ where: { room_id: 2, user_id: 9, expires_at: { gt: expect.any(Date) } } })
})
