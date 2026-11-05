import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { MentionsController } from "@server/api/v1/mentions/mentions.controller";

function makeController() {
  const controller = new MentionsController();
  const mentionsService = {
    listTargets: vi.fn(async (contextRoomId: number, userId: number) => ({
      room_id: contextRoomId,
      targets: [],
      user_id: userId,
    })),
  };
  (controller as any).mentionsService = mentionsService;
  return { controller, mentionsService };
}

describe("MentionsController", () => {
  it("requires a community id", async () => {
    const { controller } = makeController();

    await expect(controller.index(undefined, { user: { id: 1 } } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects invalid community ids", async () => {
    const { controller } = makeController();

    await expect(controller.index("abc", { user: { id: 1 } } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("delegates valid requests to the mentions service", async () => {
    const { controller, mentionsService } = makeController();

    await expect(controller.index("7", { user: { id: 42 } } as never)).resolves.toEqual({
      room_id: 7,
      targets: [],
      user_id: 42,
    });
    expect(mentionsService.listTargets).toHaveBeenCalledWith(7, 42);
  });
});
