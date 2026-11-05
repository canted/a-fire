import { withTestDependencies } from "@tests/backend/helpers/service";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  RoomBannersService,
  DEFAULT_FIRST_POST_PROMPT,
} from "@server/api/v1/rooms/room-banners.service";
import { vi } from "vitest";

const makePrisma = () => ({
  room: { findUnique: vi.fn() },
  roomBanner: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  roomBannerTarget: { updateMany: vi.fn(), upsert: vi.fn() },
  roomMembership: { findMany: vi.fn() },
  activeStorageAttachment: { findMany: vi.fn() },
});

describe("CommunityBannersService", () => {
  const makeService = (prisma = makePrisma()) => {
    return withTestDependencies(new RoomBannersService(), {
      prisma,
    });
  };

  it("lists first-post prompts for the circle owner with overridden members first", async () => {
    const service = makeService();
    service.prisma.room.findUnique.mockResolvedValue({ id: 3, owner_id: 9 });
    service.prisma.roomBanner.findFirst.mockResolvedValue({
      id: 7,
      message: "Post one thing.",
      targets: [{ user_id: 11, message_override: "Show us a photo." }],
    });
    service.prisma.roomMembership.findMany.mockResolvedValue([
      {
        id: 1,
        user_id: 10,
        username_override: null,
        user: { username: "Ada" },
      },
      {
        id: 2,
        user_id: 11,
        username_override: "Bo",
        user: { username: "Bob" },
      },
    ]);
    service.prisma.activeStorageAttachment.findMany.mockResolvedValue([{ record_id: 11, blob_id: "avatar-11" }]);

    const result = await service.listFirstPostPrompts(3, 9);

    expect(result.default_prompt).toBe(DEFAULT_FIRST_POST_PROMPT);
    expect(result.room_prompt).toBe("Post one thing.");
    expect(result.effective_room_prompt).toBe("Post one thing.");
    expect(result.members.map((member) => member.display_username)).toEqual(["Bo", "Ada"]);
    expect(result.members[0]).toEqual(
      expect.objectContaining({
        first_entry_prompt_override: "Show us a photo.",
        effective_first_entry_prompt: "Show us a photo.",
        display_avatar_url: "/api/v1/uploads/avatar-11",
      }),
    );
    expect(result.members[1].effective_first_entry_prompt).toBe("Post one thing.");
  });

  it("rejects prompt management for non-owners", async () => {
    const service = makeService();
    service.prisma.room.findUnique.mockResolvedValue({ id: 3, owner_id: 9 });

    await expect(service.listFirstPostPrompts(3, 10)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("updates the community prompt and member overrides through the banner tables", async () => {
    const service = makeService();
    service.prisma.room.findUnique.mockResolvedValue({ id: 3, owner_id: 9 });
    service.prisma.roomBanner.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 7,
        message: "Share something small.",
        targets: [{ user_id: 11, message_override: "Show us your desk." }],
      });
    service.prisma.roomBanner.create.mockResolvedValue({ id: 7, targets: [] });
    service.prisma.roomMembership.findMany
      .mockResolvedValueOnce([{ id: 2, user_id: 11 }])
      .mockResolvedValueOnce([
        {
          id: 2,
          user_id: 11,
          username_override: null,
          user: { username: "Bob" },
        },
      ]);
    service.prisma.roomBanner.update.mockResolvedValue({ id: 7 });
    service.prisma.roomBannerTarget.upsert.mockResolvedValue({ id: 21 });
    service.prisma.activeStorageAttachment.findMany.mockResolvedValue([]);

    const result = await service.updateFirstPostPrompts(3, 9, {
      roomPrompt: " Share something small. ",
      memberPrompts: [{ membershipId: 2, prompt: " Show us your desk. " }],
    });

    expect(service.prisma.roomBanner.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        room_id: 3,
        created_by_id: 9,
        kind: "first_post",
        placement: "board_header",
        message: null,
      }),
      include: { targets: true },
    });
    expect(service.prisma.roomBanner.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ message: "Share something small." }),
    });
    expect(service.prisma.roomBannerTarget.upsert).toHaveBeenCalledWith({
      where: { room_banner_id_user_id: { room_banner_id: 7, user_id: 11 } },
      create: expect.objectContaining({
        room_banner_id: 7,
        user_id: 11,
        message_override: "Show us your desk.",
      }),
      update: expect.objectContaining({ message_override: "Show us your desk." }),
    });
    expect(result.room_prompt).toBe("Share something small.");
    expect(result.members[0].effective_first_entry_prompt).toBe("Show us your desk.");
  });

  it("rejects duplicate member prompt updates", async () => {
    const service = makeService();
    service.prisma.room.findUnique.mockResolvedValue({ id: 3, owner_id: 9 });

    await expect(
      service.updateFirstPostPrompts(3, 9, {
        memberPrompts: [
          { membershipId: 2, prompt: "One" },
          { membershipId: 2, prompt: "Two" },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("resolves per-user, circle, and app-wide first-post prompts", async () => {
    const service = makeService();
    service.prisma.roomBanner.findFirst
      .mockResolvedValueOnce({
        message: "Circle nudge.",
        targets: [{ message_override: "Your own nudge." }],
      })
      .mockResolvedValueOnce({
        message: "Circle nudge.",
        targets: [{ message_override: null }],
      })
      .mockResolvedValueOnce(null);

    await expect(service.resolveFirstPostPrompt(3, 10)).resolves.toBe("Your own nudge.");
    await expect(service.resolveFirstPostPrompt(3, 10)).resolves.toBe("Circle nudge.");
    await expect(service.resolveFirstPostPrompt(3, 10)).resolves.toBe(DEFAULT_FIRST_POST_PROMPT);
  });
});
