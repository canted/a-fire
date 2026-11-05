import { expect, it, vi } from "vitest"
import { fetchMemberProfile, nextMemberHistoryPage, type MemberEntriesPayload } from "../../../../frontend/src/lib/api/members"

it("uses cursor requests on the room member identity and preserves numbered-page compatibility", async () => {
  const get = vi.fn().mockResolvedValue({})
  await fetchMemberProfile({ get }, { roomId: "4", memberUserId: "9" }, "")
  await fetchMemberProfile({ get }, { roomId: "4", memberUserId: "9" }, "opaque_cursor")
  await fetchMemberProfile({ get }, { roomId: "4", memberUserId: "9" }, 2)
  expect(get.mock.calls.map(call => call[0])).toEqual([
    "/v1/rooms/4/members/9/entries?cursor=",
    "/v1/rooms/4/members/9/entries?cursor=opaque_cursor",
    "/v1/rooms/4/members/9/entries?page=2",
  ])
  const response = (pagination: MemberEntriesPayload["pagination"]) => ({ pagination }) as MemberEntriesPayload
  expect(nextMemberHistoryPage(response({ page: 1, perPage: 20, nextPage: null, nextCursor: "next" }))).toBe("next")
  expect(nextMemberHistoryPage(response({ page: 1, perPage: 20, nextPage: 2, nextCursor: null }))).toBeNull()
  expect(nextMemberHistoryPage(response({ page: 1, perPage: 20, nextPage: 2 }))).toBe(2)
})
