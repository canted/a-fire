import { describe, expect, it, vi } from "vitest";
import { ProfileService } from "@server/api/profile/profile.service";

describe("ProfileService", () => {
  it("updates the account profile line used as the membership fallback", async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 4,
          username: "Avery",
          profile_line: null,
        }),
        update: vi.fn().mockResolvedValue({
          id: 4,
          username: "Avery",
          profile_line: "Music, composition, and sound",
        }),
      },
      activeStorageAttachment: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new ProfileService();
    (service as any).prisma = prisma;
    (service as any).uploadsService = {
      removeAttachment: vi.fn(),
      createAttachmentUpload: vi.fn(),
    };

    const result = await service.updateIdentity(4, {
      profileLine: "Music, composition, and sound",
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: {
        profile_line: "Music, composition, and sound",
        updated_at: expect.any(Date),
      },
    });
    expect(result.profile_line).toBe("Music, composition, and sound");
  });

  it("returns the canonical user avatar variant for an existing attachment", async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 4, username: "Avery", profile_line: null }),
        update: vi.fn(),
      },
      activeStorageAttachment: {
        findFirst: vi.fn().mockResolvedValue({ blob_id: 51 }),
      },
    };
    const service = new ProfileService();
    (service as any).prisma = prisma;
    (service as any).uploadsService = {
      removeAttachment: vi.fn(),
      createAttachmentUpload: vi.fn(),
    };

    const result = await service.updateIdentity(4, {});

    expect(result.avatar_url).toBe("/api/v1/uploads/51/variants/avatarStripe40");
  });

  it("returns the canonical user avatar variant immediately after upload", async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 4, username: "Avery", profile_line: null }),
        update: vi.fn(),
      },
      activeStorageAttachment: {
        findFirst: vi.fn(),
      },
    };
    const service = new ProfileService();
    (service as any).prisma = prisma;
    (service as any).uploadsService = {
      removeAttachment: vi.fn(),
      createAttachmentUpload: vi.fn().mockResolvedValue({ id: 52 }),
    };

    const result = await service.updateIdentity(4, {
      avatarFile: { originalname: "avatar.png" } as Express.Multer.File,
    });

    expect(result.avatar_url).toBe("/api/v1/uploads/52/variants/avatarStripe40");
  });
});
