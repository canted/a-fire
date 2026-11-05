import { describe, expect, it, vi } from "vitest"
import type { Request } from "express"
import { RepliesController } from "@server/api/v1/replies/replies.controller"
import { withTestDependencies } from "@tests/backend/helpers/service"

const request = { user: { id: 7 } } as unknown as Request

describe.each(["update", "publish"] as const)("Reply %s revision boundary", operation => {
  it.each([undefined, null, "100", -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])("rejects invalid revision %s before calling persistence", async expected_revision => {
    const service = { update: vi.fn(), publish: vi.fn() }
    const controller = withTestDependencies(new RepliesController(), { repliesService: service })
    await expect(controller[operation]("11", "22", { reply: { expected_revision } }, request)).rejects.toThrow("Reply revision is required")
    expect(service[operation]).not.toHaveBeenCalled()
  })
  it("forwards the caller's revision unchanged", async () => {
    const service = { update: vi.fn().mockResolvedValue({ id: 22 }), publish: vi.fn().mockResolvedValue({ id: 22 }) }
    const controller = withTestDependencies(new RepliesController(), { repliesService: service })
    const reply = { expected_revision: 100, content: { type: "doc", content: [] } }
    await expect(controller[operation]("11", "22", { reply }, request)).resolves.toEqual({ id: 22 })
    expect(service[operation]).toHaveBeenCalledExactlyOnceWith(11, 22, 7, reply)
  })
})
