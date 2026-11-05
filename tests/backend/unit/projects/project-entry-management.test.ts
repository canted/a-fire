import "reflect-metadata"
import { describe, expect, it, vi } from "vitest"
import { ProjectEntriesService } from "@server/api/v1/projects/project-entries.service"

function fixture() {
  const post = { id: 10, project_id: 2, user_id: 7, room_id: null, creation_origin: "project_material", status: "published", updated_at: new Date(1000) }
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    project: { findUnique: vi.fn().mockResolvedValue({ owner_id: 7, participations: [] }), updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    entry: { findUnique: vi.fn().mockResolvedValue(post), update: vi.fn().mockResolvedValue(post) },
  }
  const service = new ProjectEntriesService()
  Object.assign(service, { prisma: { $transaction: (fn: (client: typeof tx) => unknown) => fn(tx) } })
  return { service, tx, post }
}
describe("private project entry management", () => {
  it("moves the original in place, locking projects in order without touching copies or the document", async () => {
    const { service, tx } = fixture()
    await expect(service.changeLocation(2, 10, 7, 1000, 1)).resolves.toEqual({ id: 10, project_id: 1 })
    expect(tx.$queryRaw.mock.calls[0][1]).toBe(1)
    expect(tx.$queryRaw.mock.calls[2][1]).toBe(2)
    expect(tx.entry.update).toHaveBeenCalledExactlyOnceWith({ where: { id: 10 }, data: { project_id: 1, updated_at: expect.any(Date) } })
    expect(tx.project.updateMany.mock.calls[0][0].where.id.in).toEqual([2, 1])
  })
  it("soft deletes only the selected original", async () => {
    const { service, tx } = fixture()
    await service.changeLocation(2, 10, 7, 1000, null)
    expect(tx.entry.update).toHaveBeenCalledExactlyOnceWith({ where: { id: 10 }, data: { status: "deleted", updated_at: expect.any(Date) } })
  })
  it.each([null, 1])("rejects stale revisions for destination %s", async destination => {
    const { service, tx } = fixture()
    await expect(service.changeLocation(2, 10, 7, 999, destination)).rejects.toThrow("changed elsewhere")
    expect(tx.entry.update).not.toHaveBeenCalled()
  })
  it("requires destination access", async () => {
    const { service, tx } = fixture()
    tx.project.findUnique.mockResolvedValue({ owner_id: 99, participations: [] })
    await expect(service.changeLocation(2, 10, 7, 1000, 1)).rejects.toThrow("Project access")
    expect(tx.entry.update).not.toHaveBeenCalled()
  })
  it.each([{ user_id: 99 }, { project_id: 3 }, { status: "deleted" }, { creation_origin: "project_feedback" }])("rejects unavailable or unowned originals: %s", async patch => {
    const { service, tx, post } = fixture()
    Object.assign(post, patch)
    await expect(service.changeLocation(2, 10, 7, 1000, 1)).rejects.toThrow("Only the author")
    expect(tx.entry.update).not.toHaveBeenCalled()
  })
  it("requires a valid revision and destination", async () => {
    const { service, tx } = fixture()
    await expect(service.changeLocation(2, 10, 7, undefined, 1)).rejects.toThrow("revision")
    await expect(service.changeLocation(2, 10, 7, 1000, -1)).rejects.toThrow("Choose a project")
    expect(tx.entry.update).not.toHaveBeenCalled()
  })
})
