import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ProjectsService } from "@server/api/v1/projects/projects.service";
import { vi } from "vitest";
import { projectIdentityImages } from "@server/api/v1/uploads/identity-images";
vi.mock("@server/api/v1/uploads/identity-images", () => ({ projectIdentityImages: vi.fn() }));

function makeService() {
  vi.mocked(projectIdentityImages).mockReset().mockResolvedValue([]);
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    project: {
      create: vi.fn(),
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    projectParticipation: {
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findFirst: vi.fn() },
    entry: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn() },
    roomMembership: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), count: vi.fn() },
    reply: { findMany: vi.fn().mockResolvedValue([]) },
    entryViewState: { findMany: vi.fn().mockResolvedValue([]) },
    document: { findMany: vi.fn().mockResolvedValue([]) },
    activeStorageAttachment: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const uploads = {
    createAttachmentUpload: vi.fn(),
    removeAttachment: vi.fn(),
  };
  const service = new ProjectsService();
  (service as any).prisma = prisma;
  (service as any).uploads = uploads;
  (service as any).entries = { list: vi.fn().mockResolvedValue([]) };
  return { service, prisma, uploads };
}

const project = {
  id: 7,
  owner_id: 1,
  name: "Room Score",
  description: "A changing performance score.",
  created_at: new Date("2026-07-01T00:00:00Z"),
  updated_at: new Date("2026-07-02T00:00:00Z"),
  owner: { id: 1, username: "will" },
  participations: [
    {
      id: 11,
      project_id: 7,
      user_id: 2,
      invited_by_id: 1,
      status: "accepted",
      user: { id: 2, username: "taisha" },
    },
  ],
  rooms: [
    {
      project_id: 7,
      room_id: 4,
      created_at: new Date("2026-07-01T00:00:00Z"),
      room: { id: 4, name: "Evening Circle" },
    },
  ],
};

describe("ProjectsService", () => {
  it("does not preload historical Room posts in Project detail", async () => {
    const { service, prisma } = makeService();
    prisma.project.findUnique.mockResolvedValue(project);
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 22 });
    prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 4 }]);
    prisma.entry.findMany.mockResolvedValue([]);

    await service.show(7, 2);

    expect(prisma.entry.findMany).not.toHaveBeenCalled();
  });

  it("allows an accepted participant to associate their own circle post", async () => {
    const { service, prisma } = makeService();
    prisma.project.findUnique.mockResolvedValue(project);

    await expect(service.assertCanAssociate(7, 2, 2, 4)).resolves.toBeUndefined();
    await expect(service.assertCanAssociate(7, 1, 2, 4)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("does not allow unrelated users to associate participant posts", async () => {
    const { service, prisma } = makeService();
    prisma.project.findUnique.mockResolvedValue(project);

    await expect(service.assertCanAssociate(7, 3, 2, 4)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("requires an invited participant to accept before association", async () => {
    const { service, prisma } = makeService();
    prisma.project.findUnique.mockResolvedValue({
      ...project,
      participations: [{ ...project.participations[0], status: "pending" }],
    });

    await expect(service.assertCanAssociate(7, 2, 2, 4)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects a post from a circle the project is not associated with", async () => {
    const { service, prisma } = makeService();
    prisma.project.findUnique.mockResolvedValue(project);

    await expect(service.assertCanAssociate(7, 1, 1, 9)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("hides project details from unrelated circle members", async () => {
    const { service, prisma } = makeService();
    prisma.project.findUnique.mockResolvedValue(project);
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 22 });

    await expect(service.show(7, 3)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("filters square projects to the square's circle", async () => {
    const { service, prisma } = makeService();
    prisma.project.findMany.mockResolvedValue([]);

    await service.listForUser(1, 4, 2);

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ rooms: { some: { room_id: 4 } }, AND: expect.arrayContaining([
          { OR: [{ owner_id: 2 }, { participations: { some: { user_id: 2, status: "accepted" } } }] },
        ]) }),
      }),
    );
  });

  it("preserves all legacy posts and private entries when associated circles change", async () => {
    const { service, prisma } = makeService();
    prisma.project.findUnique
      .mockResolvedValueOnce(project)
      .mockResolvedValue(project);
    prisma.roomMembership.count.mockResolvedValue(1);
    prisma.project.update.mockResolvedValue(project);
    prisma.entry.updateMany.mockResolvedValue({ count: 1 });
    prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 4 }]);
    prisma.entry.findMany.mockResolvedValue([]);

    await service.update(7, 1, { roomIds: [4] });

    expect(prisma.entry.updateMany).not.toHaveBeenCalled();
  });

  it("allows accepted participants to view private projects without a shared circle", async () => {
    const { service, prisma } = makeService();
    prisma.project.findUnique.mockResolvedValue({ ...project, rooms: [] });
    prisma.roomMembership.findMany.mockResolvedValue([]);
    const result = await service.show(7, 2);
    expect(result).toMatchObject({ can_add_material: true, can_edit: false, viewer_participation: "accepted",  entries: [] });
    expect(prisma.roomMembership.findFirst).not.toHaveBeenCalled();
  });

  it("shows pending invitations without project content, participants, circles or media", async () => {
    const { service, prisma, uploads } = makeService();
    prisma.project.findUnique.mockResolvedValue({ ...project, participations: [{ ...project.participations[0], status: "pending" }] });
    const result = await service.show(7, 2);
    expect(result).toMatchObject({ name: "Room Score", invitation_only: true, description: null, icon_url: null, banner_url: null, banner_width: null, banner_height: null, participants: [], rooms: [],  entries: [], can_add_material: false });
    expect(prisma.entry.findMany).not.toHaveBeenCalled();
    expect(prisma.activeStorageAttachment.findMany).not.toHaveBeenCalled();
    expect(uploads.createAttachmentUpload).not.toHaveBeenCalled();
  });

  it("lists pending invitations with the same minimal metadata", async () => {
    const { service, prisma } = makeService();
    prisma.project.findMany.mockResolvedValue([{ ...project, participations: [{ ...project.participations[0], status: "pending" }] }]);
    const result = await service.listMine(2);
    expect(result.projects[0]).toMatchObject({ invitation_only: true, description: null, rooms: [], participants: [], banner_width: null, banner_height: null });
    expect(prisma.activeStorageAttachment.findMany).not.toHaveBeenCalled();
    expect(prisma.entry.findMany).not.toHaveBeenCalled();
    expect(result.projects[0]).toMatchObject({ material_activity_at: null, latest_material: null, unread_feedback_count: 0, latest_unread_feedback: null });
    expect(prisma.project.findMany.mock.calls[0][0].where.OR).not.toEqual(expect.arrayContaining([expect.objectContaining({ rooms: expect.anything() })]));
  });

  it("batches Home summaries and places projects with added material before newer empty projects", async () => {
    const { service, prisma } = makeService();
    prisma.project.findMany.mockResolvedValue([
      { ...project, id: 8, name: "Newest empty", created_at: new Date("2026-10-02T12:00:00Z"), updated_at: new Date("2026-10-02T12:00:00Z") },
      project,
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 7, material: "2026-10-01T12:00:00.000000Z", created: "2026-09-01T12:00:00.000000Z" }, { id: 8, material: null, created: "2026-10-02T12:00:00.000000Z" }]).mockResolvedValue([{ project_id: 7, material_id: 40, material_at: new Date("2026-10-01T12:00:00Z"), project_intent: "Return to the refrain", author_id: 1, author_name: "will", reply_id: null }]);
    vi.mocked(projectIdentityImages).mockResolvedValue([{ record_id: 7, name: "banner", blob_id: 99, active_storage_blobs: { metadata: JSON.stringify({ contentType: "image/jpeg", width: 1600, height: 900 }) } }]);
    const result = await service.listMine(1);
    expect(result.projects.map((item) => item.id)).toEqual([7, 8]);
    expect(result.projects[0]).toMatchObject({ latest_material: { id: 40, intent: "Return to the refrain" }, material_activity_at: "2026-10-01T12:00:00.000Z", banner_url: "/api/v1/uploads/99/variants/w1200", banner_width: 1600, banner_height: 900 });
    expect(result.projects[1]).toMatchObject({ material_activity_at: null, latest_material: null, banner_url: null, banner_width: null, banner_height: null });
    expect(projectIdentityImages).toHaveBeenCalledTimes(1);
    expect(projectIdentityImages).toHaveBeenCalledWith(prisma, [7, 8]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("provides the latest banner's decoded dimensions on a member's project detail", async () => {
    const { service, prisma } = makeService();
    prisma.project.findUnique.mockResolvedValue(project);
    vi.mocked(projectIdentityImages).mockResolvedValue([
      { record_id:7, name: "banner", blob_id: 99, active_storage_blobs: { metadata: JSON.stringify({ contentType: "image/jpeg", width: 900, height: 1200 }) } },
      { record_id:7, name: "banner", blob_id: 98, active_storage_blobs: { metadata: JSON.stringify({ contentType: "image/jpeg", width: 1200, height: 900 }) } },
    ]);
    const result = await service.show(7, 2);
    expect(result).toMatchObject({ banner_url: "/api/v1/uploads/99/variants/w1200", banner_width: 900, banner_height: 1200 });
    expect(projectIdentityImages).toHaveBeenCalledWith(prisma, [7]);
  });

  it("keeps legacy banners visible without trusting unverified dimensions", async () => {
    const { service, prisma } = makeService();
    prisma.project.findUnique.mockResolvedValue(project);
    vi.mocked(projectIdentityImages).mockResolvedValue([{ record_id:7, name: "banner", blob_id: 99, active_storage_blobs: { metadata: JSON.stringify({ width: 1200, height: 900 }) } }]);
    const result = await service.show(7, 2);
    expect(result).toMatchObject({ banner_url: "/api/v1/uploads/99/variants/w1200", banner_width: null, banner_height: null });
  });

  it("uses Untitled for an optional blank name and scopes retried creation to its owner", async () => {
    const { service, prisma } = makeService();
    prisma.project.upsert.mockResolvedValue({ id: 7 });
    prisma.project.findUnique.mockResolvedValue({ ...project, name: "Untitled", rooms: [] });
    const requestKey = "room-create-request-0001";
    await service.create(1, { name: "   ", requestKey });
    await service.create(1, { name: "   ", requestKey });
    expect(prisma.project.create).not.toHaveBeenCalled();
    expect(prisma.project.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.project.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { owner_id_creation_request_key: { owner_id: 1, creation_request_key: requestKey } },
      create: expect.objectContaining({ name: "Untitled", owner_id: 1, creation_request_key: requestKey, rooms: { create: [] } }),
      update: {},
    }));
  });

  it("creates a private project without circles", async () => {
    const { service, prisma } = makeService();
    prisma.project.create.mockResolvedValue({ id: 7 });
    prisma.project.findUnique.mockResolvedValue({ ...project, rooms: [] });
    prisma.roomMembership.findMany.mockResolvedValue([]);
    await service.create(1, { name: "Solo work" });
    expect(prisma.project.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ owner_id: 1, rooms: { create: [] } }) }));
    expect(prisma.roomMembership.count).not.toHaveBeenCalled();
  });

  it("persists approved identity choices and returns them with the project", async () => {
    const { service, prisma } = makeService();
    prisma.project.create.mockResolvedValue({ id: 7 });
    prisma.project.findUnique.mockResolvedValue({ ...project, icon_symbol: "projectClover", icon_color: "purple" });
    const result = await service.create(1, { name: "Solo work", iconSymbol: "projectClover", iconColor: "purple" });
    expect(prisma.project.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ icon_symbol: "projectClover", icon_color: "purple" }) }));
    expect(result).toMatchObject({ icon_symbol: "projectClover", icon_color: "purple" });
  });
  it("rejects arbitrary symbols and colors before writing", async () => {
    const { service, prisma } = makeService();
    await expect(service.create(1, { name: "Solo", iconSymbol: "unknown" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(1, { name: "Solo", iconColor: "#ffffff" })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it("invites existing app users without requiring shared circle membership or outreach", async () => {
    const { service, prisma } = makeService();
    prisma.project.findUnique.mockResolvedValue({ ...project, rooms: [] });
    prisma.user.findFirst.mockResolvedValue({ id: 3, username: "new-member" });
    prisma.roomMembership.findMany.mockResolvedValue([]);
    await service.invite(7, 1, "new-member");
    expect(prisma.projectParticipation.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ user_id: 3, status: "pending" }) }));
    expect(prisma.roomMembership.findFirst).not.toHaveBeenCalled();
  });

  it("only lets the owner change membership or project settings", async () => {
    const { service, prisma } = makeService();
    prisma.project.findUnique.mockResolvedValue(project);
    await expect(service.update(7, 2, { name: "Changed" })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.invite(7, 2, "new-member")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.removeParticipant(7, 2, 1)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(prisma.projectParticipation.updateMany).not.toHaveBeenCalled();
  });

  it("declines an invitation without reading private details afterwards", async () => {
    const { service, prisma } = makeService();
    prisma.projectParticipation.findUnique.mockResolvedValue({ id: 11, status: "pending" });
    await expect(service.decline(7, 2)).resolves.toEqual({ id: 7, viewer_participation: "declined" });
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });
});
