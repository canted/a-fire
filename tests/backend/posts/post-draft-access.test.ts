import { describe, expect, it, vi } from "vitest";
import {
  canManageEntryDraft,
  canReadRoundDraft,
} from "@server/api/v1/entries/entry-draft-access";
import { parseEntryFormatData } from "@server/api/v1/entries/entry-formats";
import type { PrismaService } from "@server/prisma/prisma.service";
import type { RoomAccessService } from "@server/api/v1/rooms/room-access.service";

describe("private project material draft permissions", () => {
  const post = {
    id: 12,
    user_id: 2,
    project_id: 8,
    room_id: null,
    creation_origin: "project_material",
    status: "draft",
  };

  it.each([
    [2, "draft", "project_material", true],
    [2, "published", "project_material", true],
    [1, "draft", "project_material", false],
    [1, "published", "project_material", false],
    [2, "published", "project_feedback", false],
    [2, "deleted", "project_material", false],
  ])("allows only the material author to edit (%s/%s/%s)", async (userId, status, creationOrigin, expected) => {
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ owner_id: 1, participations: [{ id: 9 }] }) },
    } as unknown as PrismaService;
    const access = { resolve: vi.fn() } as unknown as RoomAccessService;
    expect(await canManageEntryDraft(prisma, access, { ...post, status, creation_origin: creationOrigin }, userId)).toBe(expected);
    expect(access.resolve).not.toHaveBeenCalled();
  });

  it("revokes access immediately when the author leaves the project", async () => {
    const findUnique = vi.fn()
      .mockResolvedValueOnce({ owner_id: 1, participations: [{ id: 9 }] })
      .mockResolvedValueOnce({ owner_id: 1, participations: [] });
    const prisma = { project: { findUnique } } as unknown as PrismaService;
    const access = { resolve: vi.fn() } as unknown as RoomAccessService;
    expect(await canManageEntryDraft(prisma, access, post, 2)).toBe(true);
    expect(await canManageEntryDraft(prisma, access, post, 2)).toBe(false);
    expect(findUnique).toHaveBeenLastCalledWith({
      where: { id: 8 },
      select: { owner_id: true, participations: { where: { user_id: 2, status: "accepted" }, select: { id: true } } },
    });
  });


});

it("validates and preserves safe saved text colors", () => {
  expect(parseEntryFormatData({ text_style: { background: "#153C66", color: "#FFFFFF", extra: "ignored" } })).toEqual({
    text_style: { background: "#153C66", color: "#FFFFFF" },
  });
  expect(() => parseEntryFormatData({ text_style: { background: "url(https://example.com)", color: "#FFFFFF" } })).toThrow();
});

describe("canReadActivityDraft", () => {
  const post = {
    id: 30,
    user_id: 2,
    status: "draft",
    round_id: 9,
    room_id: 4,
    source_entry_id: 9,
  };

  it("lets only the participant offered a concealed cover read its media", async () => {
    const prisma = {
      activityArtifact: {
        findUnique: vi.fn().mockResolvedValue({
          id: 50,
          round_id: 9,
          kind: "cover",
          status: "active",
          round: {
            template_key: "art_before_chorus",
            room_id: 4,
            host_id: 1,
            status: "active",
            closed_at: null,
            submit_by: new Date(Date.now() - 60_000),
            feedback_due_at: new Date(Date.now() + 60_000),
          },
        }),
      },
      activityOffer: { findFirst: vi.fn().mockResolvedValue({ id: 80 }) },
    };
    const access = { resolve: vi.fn().mockResolvedValue({ kind: "member" }) };

    await expect(canReadRoundDraft(prisma as never, access as never, post, 3)).resolves.toBe(true);
    expect(prisma.activityOffer.findFirst).toHaveBeenCalledWith({
      where: {
        round_id: 9,
        user_id: 3,
        OR: [{ first_artifact_id: 50 }, { second_artifact_id: 50 }],
      },
      select: { id: true },
    });
    prisma.activityOffer.findFirst.mockClear();
    access.resolve.mockResolvedValue(null);
    await expect(canReadRoundDraft(prisma as never, access as never, post, 3)).resolves.toBe(false);
    expect(prisma.activityOffer.findFirst).not.toHaveBeenCalled();
  });

  it("does not expose response media before the reveal", async () => {
    const prisma = {
      activityArtifact: {
        findUnique: vi.fn().mockResolvedValue({
          id: 51,
          round_id: 9,
          kind: "response",
          status: "active",
          round: {
            template_key: "art_before_chorus",
            room_id: 4,
            host_id: 1,
            status: "active",
            closed_at: null,
            submit_by: new Date(Date.now() - 60_000),
            feedback_due_at: new Date(Date.now() + 60_000),
          },
        }),
      },
      activityOffer: { findFirst: vi.fn() },
    };

    await expect(canReadRoundDraft(prisma as never, { resolve: vi.fn().mockResolvedValue({ kind: "member" }) } as never, post, 3)).resolves.toBe(false);
    expect(prisma.activityOffer.findFirst).not.toHaveBeenCalled();
  });

  it("keeps contribution media concealed when a Activity is cancelled", async () => {
    const prisma = {
      activityArtifact: {
        findUnique: vi.fn().mockResolvedValue({
          id: 51,
          round_id: 9,
          kind: "response",
          status: "active",
          round: {
            template_key: "art_before_chorus",
            room_id: 4,
            host_id: 1,
            status: "cancelled",
            closed_at: new Date(),
            submit_by: new Date(Date.now() - 120_000),
            feedback_due_at: new Date(Date.now() - 60_000),
          },
        }),
      },
      activityOffer: { findFirst: vi.fn() },
    };
    const access = { resolve: vi.fn().mockResolvedValue({ kind: "member" }) };

    await expect(canReadRoundDraft(prisma as never, access as never, post, 3)).resolves.toBe(false);
    expect(access.resolve).not.toHaveBeenCalled();
  });
});


describe("Room author draft access", () => {
  it.each([
    [{ kind: "member", canWriteWall: true }, true],
    [{ kind: "member", canWriteWall: false }, false],
    [{ kind: "visitor", canWriteWall: false }, false],
    [null, false],
  ])("requires current writable membership (%j)", async (membership, expected) => {
    const access = { resolve: vi.fn().mockResolvedValue(membership) };
    const post = { id: 1, user_id: 2, status: "draft", room_id: 4, source_entry_id: 9 };
    expect(await canManageEntryDraft({} as PrismaService, access as unknown as RoomAccessService, post, 2)).toBe(expected);
    expect(access.resolve).toHaveBeenCalledWith(4, 2);
  });
  it("denies missing Room context or missing private source", async () => {
    const access = { resolve: vi.fn().mockResolvedValue({ kind: "member" }) };
    const post = { id: 1, user_id: 2, status: "draft", source_entry_id: 9 };
    expect(await canManageEntryDraft({} as PrismaService, access as unknown as RoomAccessService, post, 2)).toBe(false);
    expect(await canManageEntryDraft({} as PrismaService, access as unknown as RoomAccessService, { ...post, room_id: 4, source_entry_id: null }, 2)).toBe(false);
    expect(access.resolve).not.toHaveBeenCalled();
  });
});
