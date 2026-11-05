import { compareProjectActivity, emptyProjectActivity, loadProjectActivity } from "@server/api/v1/projects/project-activity"
import { vi } from "vitest"

const at = (day: number) => new Date(`2026-10-${String(day).padStart(2, "0")}T12:00:00Z`)

describe("project Home activity presentation", () => {
  it("orders material before empty Projects, then uses stable timestamp and ID ties", () => {
    const activity = new Map([7, 8, 9, 10].map(id => [id, emptyProjectActivity()]))
    activity.get(7)!.material_activity_at = at(5).toISOString()
    activity.get(8)!.material_activity_at = at(5).toISOString()
    const projects = [{ id: 9, created_at: at(2) }, { id: 10, created_at: at(3) }, { id: 8, created_at: at(1) }, { id: 7, created_at: at(1) }]
    expect(projects.sort((a, b) => compareProjectActivity(a, b, activity)).map(project => project.id)).toEqual([8, 7, 10, 9])
  })

  it("does not query when there are no authorized Projects", async () => {
    const database = { $queryRaw: vi.fn() }
    expect(await loadProjectActivity(database, [], 1)).toEqual(new Map())
    expect(database.$queryRaw).not.toHaveBeenCalled()
  })

  it("formats bounded summary rows and retains honest media-only feedback text", async () => {
    const database = { $queryRaw: vi.fn().mockResolvedValue([{
      project_id: 7, material_id: 10, material_at: at(3), project_intent: "Return to this", author_id: 1, author_name: "Writer",
      unread_count: 2, reply_id: 52, entry_id: 30, reply_at: at(5), reply_author: "Someone", room_name: "Room", reply_content: null,
    }]) }
    const activity = await loadProjectActivity(database, [7, 8], 1)
    expect(activity.get(7)).toMatchObject({ material_activity_at: at(3).toISOString(), latest_material: { id: 10, intent: "Return to this", author: { id: 1, username: "Writer" } }, unread_feedback_count: 2, latest_unread_feedback: { reply_id: 52, source_author_name: "Someone", excerpt: null } })
    expect(activity.get(8)).toEqual(emptyProjectActivity())
  })
})
