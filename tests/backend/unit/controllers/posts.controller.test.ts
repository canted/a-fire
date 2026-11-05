import "reflect-metadata"
import { expect, it, vi } from "vitest"
import type { Request } from "express"
import { EntriesController } from "@server/api/v1/entries/entries.controller"

it("requires a valid editor revision before delegating a content save", async () => {
  const controller = new EntriesController()
  const saveContent = vi.fn().mockResolvedValue({ revision: 101 })
  Object.assign(controller, { postsService: { saveContent } })
  const request = { user: { id: 7 } } as unknown as Request
  for (const expected_revision of [undefined, null, "100", -1, 1.5, Infinity]) {
    await expect(controller.saveContent("42", { expected_revision }, request)).rejects.toThrow("revision is required")
  }
  expect(saveContent).not.toHaveBeenCalled()
  await expect(controller.saveContent("42", { content: {}, expected_revision: 100 }, request)).resolves.toEqual({ revision: 101 })
  expect(saveContent).toHaveBeenCalledWith(42, 7, {}, undefined, undefined, undefined, undefined, undefined, 100)
})

it("does not expose the retired Square draft allocation handler", () => {
  expect(EntriesController.prototype).not.toHaveProperty("draft")
})
