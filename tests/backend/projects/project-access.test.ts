import { canEditProjectEntry, canReadProjectEntry, canViewProject, isProjectEntry } from "@server/api/v1/projects/project-access"
import { vi } from "vitest"

const material = { project_id: 7, room_id: null, creation_origin: "project_material", user_id: 2, status: "published" }

describe("private project access", () => {
  it("distinguishes private Project entries from Room copies", () => {
    expect(isProjectEntry(material)).toBe(true)
    expect(isProjectEntry({ ...material, creation_origin: "project_feedback" })).toBe(true)
    expect(isProjectEntry({ ...material, room_id: 4 })).toBe(false)
    expect(isProjectEntry({ ...material, project_id: null, room_id: 4 })).toBe(false)
    expect(isProjectEntry({ ...material, creation_origin: null })).toBe(false)
  })

  it("uses ownership and accepted project participation, without circle access inheritance", async () => {
    const prisma = { project: { findUnique: vi.fn().mockResolvedValue({ owner_id: 1, participations: [] }) } } as any
    await expect(canViewProject(prisma, 7, 1)).resolves.toBe(true)
    await expect(canViewProject(prisma, 7, 3)).resolves.toBe(false)
    expect(prisma.project.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ select: expect.objectContaining({ participations: { where: { user_id: 3, status: "accepted" }, select: { id: true } } }) }))
    prisma.project.findUnique.mockResolvedValue({ owner_id: 1, participations: [{ id: 2 }] })
    await expect(canViewProject(prisma, 7, 2)).resolves.toBe(true)
    await expect(canViewProject(prisma, 0, 2)).resolves.toBe(false)
  })

  it("permits members to edit only their own material and keeps feedback read-only", async () => {
    const prisma = { project: { findUnique: vi.fn().mockResolvedValue({ owner_id: 1, participations: [{ id: 2 }] }) } } as any
    await expect(canEditProjectEntry(prisma, material, 2)).resolves.toBe(true)
    await expect(canEditProjectEntry(prisma, material, 1)).resolves.toBe(false)
    await expect(canEditProjectEntry(prisma, { ...material, creation_origin: "project_feedback" }, 2)).resolves.toBe(false)
    prisma.project.findUnique.mockResolvedValue({ owner_id: 1, participations: [] })
    await expect(canEditProjectEntry(prisma, material, 2)).resolves.toBe(false)
  })

  it("reads saved feedback, conceals another author's draft and denies deleted entries", async () => {
    const prisma = { project: { findUnique: vi.fn().mockResolvedValue({ owner_id: 1, participations: [] }) } } as any
    await expect(canReadProjectEntry(prisma, { ...material, creation_origin: "project_feedback" }, 1)).resolves.toBe(true)
    await expect(canReadProjectEntry(prisma, { ...material, status: "draft" }, 1)).resolves.toBe(false)
    await expect(canReadProjectEntry(prisma, { ...material, status: "deleted" }, 1)).resolves.toBe(false)
    prisma.project.findUnique.mockResolvedValue({ owner_id: 1, participations: [{ id: 2 }] })
    await expect(canReadProjectEntry(prisma, { ...material, status: "draft" }, 2)).resolves.toBe(true)
  })
})
