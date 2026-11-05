import { capturePosthogEvent } from "../../../runtime/posthog"
import type { Prisma } from "@prisma/client"
import { privateProjectWhere } from "./project-access"
import { projectIdentityImages } from "../uploads/identity-images"
import { projectListPage } from "./project-list-page"
import { projectSymbols, projectColors } from "../../../../types/project-identity"
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"
import { UploadsService } from "../uploads/uploads.service"
import { uploadVariantUrl } from "../uploads/upload-urls"
import { imageDimensionsFromMetadata } from "../uploads/image-presentation"
import { emptyProjectActivity, loadProjectActivity, type ProjectActivity } from "./project-activity"

type ProjectInput = {
  requestKey?: string
  iconSymbol?: string
  iconColor?: string
  name?: string
  description?: string | null
  roomIds?: number[]
  iconFile?: Express.Multer.File
  bannerFile?: Express.Multer.File
  removeIcon?: boolean
  removeBanner?: boolean
}

type ProjectImageAttachment = {
  name: string
  blob_id: number
  active_storage_blobs: { metadata: string | null }
}

@Injectable()
export class ProjectsService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(UploadsService)
  private readonly uploads!: UploadsService

  async listMine(userId: number, communityId?: number, cursor = "") {
    if (communityId && !(await this.isCircleMember(userId, communityId))) return { projects: [], nextCursor: null }
    const page = await projectListPage(this.prisma, userId, communityId, cursor)
    const projects = await this.projectRows({
      id: { in: page.ids },
      ...(communityId ? { rooms: { some: { room_id: communityId } } } : {}),
      OR: [{ owner_id: userId }, { participations: { some: { user_id: userId, status: { in: ["accepted", "pending"] } } } }],
    })
    const order = new Map(page.ids.map((id, index) => [id, index]))
    projects.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
    return { nextCursor: page.nextCursor, projects: await this.projectSummaries(projects, userId) }
  }

  /** Home hydrates only its four recent entries and three displayed Projects. */
  async homeSummaries(userId: number, ids: number[]) {
    const projectIds = [...new Set(ids)]
    if (projectIds.length > 7) throw new BadRequestException("Home Project selection exceeds its bound")
    if (!projectIds.length) return []
    return this.projectSummaries(await this.projectRows({ id: { in: projectIds }, ...privateProjectWhere(userId) }), userId)
  }

  private projectRows(where: Prisma.ProjectWhereInput) {
    return this.prisma.project.findMany({ where, include: {
      owner: { select: { id: true, username: true } },
      rooms: { include: { room: true } },
      participations: { where: { status: { in: ["accepted", "pending"] } }, include: { user: { select: { id: true, username: true } } } },
    } })
  }

  private async projectSummaries(projects: Awaited<ReturnType<ProjectsService["projectRows"]>>, userId: number) {
    const visibleIds = projects.filter(project => this.canView(project, userId)).map(project => project.id)
    const [activity, attachments] = await Promise.all([
      loadProjectActivity(this.prisma, visibleIds, userId), this.summaryImages(visibleIds),
    ])
    return Promise.all(projects.map(project => this.canView(project, userId)
      ? this.summary(project, project.owner_id === userId, userId, { activity: activity.get(project.id)!, attachments: attachments.get(project.id) ?? [] })
      : this.invitationSummary(project)))
  }

  async listForUser(profileUserId: number, communityId: number, viewerId?: number) {
    if (!viewerId) return []
    const projects = await this.prisma.project.findMany({
      where: {
        rooms: { some: { room_id: communityId } },
        AND: [
          { OR: [{ owner_id: profileUserId }, { participations: { some: { user_id: profileUserId, status: "accepted" } } }] },
          { OR: [{ owner_id: viewerId }, { participations: { some: { user_id: viewerId, status: "accepted" } } }] },
        ],
      },
      include: {
        owner: { select: { id: true, username: true } },
        rooms: { include: { room: true } },
        participations: { where: { status: "accepted" }, include: { user: { select: { id: true, username: true } } } },
      },
      orderBy: [{ updated_at: "desc" }, { id: "desc" }],
    })
    const attachments = await this.summaryImages(projects.map(project => project.id))
    return Promise.all(projects.map((project) => this.summary(project, false, viewerId, { attachments: attachments.get(project.id) ?? [] })))
  }

  async show(projectId: number, viewerId: number) {
    const project = await this.project(projectId)
    if (!this.canView(project, viewerId)) {
      if (project.participations.some((item) => item.user_id === viewerId && item.status === "pending")) {
        return { ...this.invitationSummary(project), entries: [], own_draft_id: null }
      }
      throw new NotFoundException("Project not found")
    }
    const ownDraft = await this.prisma.entry.findFirst({
        where: { project_id: projectId, user_id: viewerId, status: "draft", creation_origin: "project_material", room_id: null },
        select: { id: true },
        orderBy: { updated_at: "desc" },
      })

    return {
      ...(await this.summary(project, project.owner_id === viewerId, viewerId)),
      can_edit: project.owner_id === viewerId,
      can_add_material: true,
      invitation_only: false,
      entries: [], // Compatibility field; timeline lives at GET :id/entries.
      own_draft_id: ownDraft?.id ?? null,
      viewer_participation:
        project.owner_id === viewerId
          ? "owner"
          : project.participations.find((participation) => participation.user_id === viewerId)?.status ?? null,
    }
  }

  async create(userId: number, input: ProjectInput) {
    const name = this.name(input.name)
    const roomIds = this.roomIds(input.roomIds)
    await this.assertCircleMemberships(userId, roomIds)
    const now = new Date()
    const requestKey = input.requestKey?.trim();
    if (requestKey && !/^[a-zA-Z0-9_-]{16,100}$/.test(requestKey)) throw new BadRequestException("Invalid project request key");
    const data = {
        ...this.identityInput(input),
        owner_id: userId,
        name,
        description: this.description(input.description),
        rooms: {
          create: roomIds.map((communityId) => ({ room_id: communityId, created_at: now })),
        },
        created_at: now,
        updated_at: now,
        ...(requestKey ? { creation_request_key: requestKey } : {}),
    };
    const project = requestKey
      ? await this.prisma.project.upsert({
          where: { owner_id_creation_request_key: { owner_id: userId, creation_request_key: requestKey } },
          create: data, update: {},
        })
      : await this.prisma.project.create({ data });
    capturePosthogEvent({ distinctId: userId, event: "project_created", properties: {
      project_id: project.id, $insert_id: `project-created:${project.id}`, room_count: roomIds.length,
    } })
    await this.updateImages(project.id, userId, input)
    return this.show(project.id, userId)
  }

  async update(projectId: number, userId: number, input: ProjectInput) {
    await this.assertOwner(projectId, userId)
    const roomIds = input.roomIds === undefined ? undefined : this.roomIds(input.roomIds)
    if (roomIds) await this.assertCircleMemberships(userId, roomIds)
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...this.identityInput(input),
        ...(input.name !== undefined ? { name: this.name(input.name) } : {}),
        ...(input.description !== undefined ? { description: this.description(input.description) } : {}),
        ...(roomIds
          ? {
              rooms: {
                deleteMany: {},
                create: roomIds.map((communityId) => ({ room_id: communityId, created_at: new Date() })),
              },
            }
          : {}),
        updated_at: new Date(),
      },
    })
    await this.updateImages(projectId, userId, input)
    return this.show(projectId, userId)
  }

  async invite(projectId: number, ownerId: number, rawUsername: string) {
    await this.assertOwner(projectId, ownerId)
    const username = typeof rawUsername === "string" ? rawUsername.trim() : ""
    if (!username) throw new BadRequestException("Username is required")
    const user = await this.prisma.user.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
    })
    if (!user) throw new NotFoundException("User not found")
    if (user.id === ownerId) throw new BadRequestException("The owner is already part of this project")
    const existing = await this.prisma.projectParticipation.findUnique({ where: { project_id_user_id: { project_id: projectId, user_id: user.id } } })
    if (existing?.status === "accepted") return this.show(projectId, ownerId)
    const now = new Date()
    await this.prisma.projectParticipation.upsert({
      where: { project_id_user_id: { project_id: projectId, user_id: user.id } },
      create: {
        project_id: projectId,
        user_id: user.id,
        invited_by_id: ownerId,
        status: "pending",
        invited_at: now,
        created_at: now,
        updated_at: now,
      },
      update: {
        invited_by_id: ownerId,
        status: "pending",
        invited_at: now,
        responded_at: null,
        updated_at: now,
      },
    })
    return this.show(projectId, ownerId)
  }

  async accept(projectId: number, userId: number) {
    return this.respond(projectId, userId, "accepted")
  }

  async decline(projectId: number, userId: number) {
    return this.respond(projectId, userId, "declined")
  }

  async removeParticipant(projectId: number, ownerId: number, participantId: number) {
    await this.assertOwner(projectId, ownerId)
    if (participantId === ownerId) throw new BadRequestException("The project owner cannot be removed")
    await this.prisma.projectParticipation.updateMany({
      where: { project_id: projectId, user_id: participantId },
      data: { status: "removed", updated_at: new Date() },
    })
    return this.show(projectId, ownerId)
  }

  async assertCanAssociate(projectId: number, actorId: number, postAuthorId: number, communityId: number | null) {
    const project = await this.project(projectId)
    if (!communityId || !project.rooms.some((circle) => circle.room_id === communityId)) {
      throw new ForbiddenException("The project is not associated with this post's circle")
    }
    const authorAccepted =
      project.owner_id === postAuthorId ||
      project.participations.some(
        (participation) => participation.user_id === postAuthorId && participation.status === "accepted",
      )
    if (!authorAccepted) throw new ForbiddenException("The post author is not part of this project")
    if (actorId !== postAuthorId) throw new ForbiddenException("Only the author can share their material")
  }

  private async respond(projectId: number, userId: number, status: "accepted" | "declined") {
    const participation = await this.prisma.projectParticipation.findUnique({
      where: { project_id_user_id: { project_id: projectId, user_id: userId } },
    })
    if (!participation || participation.status !== "pending") throw new NotFoundException("Pending invitation not found")
    await this.prisma.projectParticipation.update({
      where: { id: participation.id },
      data: { status, responded_at: new Date(), updated_at: new Date() },
    })
    return status === "accepted" ? this.show(projectId, userId) : { id: projectId, viewer_participation: "declined" }
  }

  private async project(projectId: number) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        owner: { select: { id: true, username: true } },
        rooms: { include: { room: true } },
        participations: { where: { status: { in: ["accepted", "pending"] } }, include: { user: { select: { id: true, username: true } } } },
      },
    })
    if (!project) throw new NotFoundException("Project not found")
    return project
  }

  private async assertOwner(projectId: number, userId: number) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } })
    if (!project || project.owner_id !== userId) throw new ForbiddenException("Forbidden")
  }

  private async summaryImages(projectIds: number[]) {
    const attachments = await projectIdentityImages(this.prisma, projectIds)
    const byProject = new Map<number, ProjectImageAttachment[]>()
    for (const attachment of attachments) {
      const images = byProject.get(attachment.record_id) ?? []
      images.push(attachment)
      byProject.set(attachment.record_id, images)
    }
    return byProject
  }

  private async summary(
    project: Awaited<ReturnType<ProjectsService["project"]>>,
    includePending = false,
    viewerId?: number,
    loaded?: { activity?: ProjectActivity; attachments: ProjectImageAttachment[] },
  ) {
    const attachments = loaded?.attachments ?? await projectIdentityImages(this.prisma, [project.id])
    const attachment = (name: string) => attachments.find((item) => item.name === name)
    const icon = attachment("icon")
    const banner = attachment("banner")
    const bannerDimensions = imageDimensionsFromMetadata(banner?.active_storage_blobs?.metadata)
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      owner: { id: project.owner.id, username: project.owner.username },
      participants: project.participations
        .filter((participation) => participation.status === "accepted")
        .map((participation) => ({ id: participation.user.id, username: participation.user.username })),
      pending_participants: includePending
        ? project.participations
            .filter((participation) => participation.status === "pending")
            .map((participation) => ({ id: participation.user.id, username: participation.user.username }))
        : [],
      rooms: project.rooms.map((circle) => ({
        id: circle.room.id,
        name: circle.room.name,
      })),
      icon_symbol: project.icon_symbol,
      icon_color: project.icon_color,
      icon_url: icon ? uploadVariantUrl(`/api/v1/uploads/${icon.blob_id}`, "icon160") : null,
      banner_url: banner ? uploadVariantUrl(`/api/v1/uploads/${banner.blob_id}`, "w1200") : null,
      banner_width: bannerDimensions?.width ?? null,
      banner_height: bannerDimensions?.height ?? null,
      updated_at: project.updated_at.toISOString(),
      visibility: "private" as const,
      can_edit: project.owner_id === viewerId,
      can_add_material: viewerId ? this.canView(project, viewerId) : false,
      viewer_participation: project.owner_id === viewerId ? "owner" : project.participations.find((item) => item.user_id === viewerId)?.status ?? null,
      ...(loaded ? loaded.activity : {}),
    }
  }

  private identityInput(input: ProjectInput) {
    if (input.iconSymbol !== undefined && !projectSymbols.includes(input.iconSymbol as typeof projectSymbols[number])) throw new BadRequestException("Choose a project icon from the available symbols.")
    if (input.iconColor !== undefined && !projectColors.includes(input.iconColor as typeof projectColors[number])) throw new BadRequestException("Choose a project color from the available colors.")
    return { ...(input.iconSymbol !== undefined ? { icon_symbol: input.iconSymbol } : {}), ...(input.iconColor !== undefined ? { icon_color: input.iconColor } : {}) }
  }

  private invitationSummary(project: Awaited<ReturnType<ProjectsService["project"]>>) {
    return {
      id: project.id, name: project.name, description: null,
      owner: { id: project.owner.id, username: project.owner.username },
      participants: [], pending_participants: [], rooms: [], icon_url: null, banner_url: null, banner_width: null, banner_height: null,
      updated_at: project.updated_at.toISOString(), visibility: "private" as const,
      can_edit: false, can_add_material: false, viewer_participation: "pending", invitation_only: true,
      ...emptyProjectActivity(),
    }
  }

  private async updateImages(projectId: number, userId: number, input: ProjectInput) {
    if (input.removeIcon) {
      await this.uploads.removeAttachment(userId, { record_type: "Project", record_id: projectId, name: "icon" })
    }
    if (input.removeBanner) {
      await this.uploads.removeAttachment(userId, { record_type: "Project", record_id: projectId, name: "banner" })
    }
    if (input.iconFile) {
      await this.uploads.createAttachmentUpload(userId, input.iconFile, {
        record_type: "Project",
        record_id: projectId,
        name: "icon",
      })
    }
    if (input.bannerFile) {
      await this.uploads.createAttachmentUpload(userId, input.bannerFile, {
        record_type: "Project",
        record_id: projectId,
        name: "banner",
      })
    }
  }

  private canView(project: Awaited<ReturnType<ProjectsService["project"]>>, userId: number) {
    return project.owner_id === userId || project.participations.some((item) => item.user_id === userId && item.status === "accepted")
  }

  private async isCircleMember(userId: number, communityId: number) {
    return Boolean(await this.prisma.roomMembership.findFirst({
      where: { user_id: userId, room_id: communityId, disabled: false },
      select: { id: true },
    }))
  }

  private async assertCircleMemberships(userId: number, roomIds: number[]) {
    if (!roomIds.length) return
    const count = await this.prisma.roomMembership.count({
      where: { user_id: userId, room_id: { in: roomIds }, disabled: false },
    })
    if (count !== roomIds.length) throw new ForbiddenException("Choose only circles you belong to")
  }

  private roomIds(values?: number[]) {
    if (values?.some((value) => !Number.isInteger(value) || value <= 0)) throw new BadRequestException("Invalid circle")
    return [...new Set(values ?? [])]
  }

  private name(value?: string) {
    const name = typeof value === "string" ? value.trim() : ""
    if (!name) return "Untitled"
    if (name.length > 120) throw new BadRequestException("Project name is too long")
    return name
  }

  private description(value?: string | null) {
    if (value != null && typeof value !== "string") throw new BadRequestException("Project description must be text")
    const description = value?.trim() ?? ""
    return description || null
  }
}
