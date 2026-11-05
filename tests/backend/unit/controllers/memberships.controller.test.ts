import { describe, expect, it, vi } from "vitest";

import { MembershipsController } from "@server/api/v1/memberships/memberships.controller";

function makeController() {
  const controller = new MembershipsController();
  const membershipsService = {
    update: vi.fn(async (_userId: number, membershipId: number, payload: unknown) => ({
      id: membershipId,
      payload,
    })),
  };
  (controller as any).membershipsService = membershipsService;
  return { controller, membershipsService };
}

describe("MembershipsController", () => {
  it("parses flat multipart membership fields from onboarding", async () => {
    const { controller, membershipsService } = makeController();

    await controller.update(
      "9",
      {
        "membership[username_override]": "",
        "membership[profile_line_override]": "  Sound, composition, and performance  ",
        "membership[remove_avatar]": "true",
      },
      { user: { id: 4 } } as never,
    );

    expect(membershipsService.update).toHaveBeenCalledWith(4, 9, {
      username_override: null,
      profile_line_override: "Sound, composition, and performance",
      notify: undefined,
      avatarFile: undefined,
      removeAvatar: true,
    });
  });
});
