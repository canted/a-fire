import { describe, expect, it, vi } from "vitest";

import { MembershipsService } from "@server/api/v1/memberships/memberships.service";

function makeService() {
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 5 }]),
    $transaction: vi.fn(function(this: unknown, callback: (database: unknown) => unknown) { return callback(this); }),
    roomMembership: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    activeStorageAttachment: {
      findFirst: vi.fn(),
    },
  };
  const uploadsService = {
    removeAttachment: vi.fn(),
    createAttachmentUpload: vi.fn(),
  };
  const service = new MembershipsService();
  (service as any).prisma = prisma;
  (service as any).uploadsService = uploadsService;
  return { service, prisma, uploadsService };
}

describe("MembershipsService", () => {
  it("clears overrides and removes circle avatars for default appearance", async () => {
    const { service, prisma, uploadsService } = makeService();
    const membership = {
      id: 9,
      room_id: 5,
      user_id: 4,
      username_override: "Avery",
      profile_line_override: "Ambient composition",
      disabled: false,
      notify: true,
      room: { id: 5, name: "Circle" },
      user: { username: "avery", profile_line: "Music and field recordings" },
    };
    prisma.roomMembership.findFirst.mockResolvedValue(membership);
    prisma.roomMembership.update.mockResolvedValue({
      ...membership,
      username_override: null,
      profile_line_override: null,
    });
    prisma.activeStorageAttachment.findFirst.mockResolvedValue(null);

    const result = await service.update(4, 9, {
      username_override: null,
      profile_line_override: null,
      removeAvatar: true,
    });

    expect(prisma.roomMembership.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9 },
        data: {
          username_override: null,
          profile_line_override: null,
          updated_at: expect.any(Date),
        },
      }),
    );
    expect(uploadsService.removeAttachment).toHaveBeenCalledWith(4, {
      record_type: "CircleMembership",
      record_id: 9,
      name: "avatar",
    });
    expect(result.display_username).toBe("avery");
    expect(result.display_profile_line).toBe("Music and field recordings");
    expect(result.avatar_url).toBeNull();
  });
});
