import { describe, expect, it, vi } from "vitest";

import { PagesController } from "@server/api/v1/pages/pages.controller";

function makeController() {
  const controller = new PagesController();
  const pagesWriteService = {
    prependContentBlocks: vi.fn(async () => ({
      page: {
        id: 7,
        title: "Target",
        icon: null,
        room_id: 1,
        parent_id: null,
        content: { type: "doc", content: [] },
      },
    })),
  };
  (controller as any).pagesWriteService = pagesWriteService;
  return { controller, pagesWriteService };
}

describe("PagesController", () => {
  it("delegates block prepend requests to the write service", async () => {
    const { controller, pagesWriteService } = makeController();
    const body = {
      blocks: [{ type: "paragraph", content: [{ type: "text", text: "Moved" }] }],
      position: "top" as const,
    };

    await expect(controller.prependContentBlocks("7", body, { user: { id: 42 } } as never)).resolves.toEqual({
      page: {
        id: 7,
        title: "Target",
        icon: null,
        room_id: 1,
        parent_id: null,
        content: { type: "doc", content: [] },
      },
    });
    expect(pagesWriteService.prependContentBlocks).toHaveBeenCalledWith(7, 42, body);
  });
});
