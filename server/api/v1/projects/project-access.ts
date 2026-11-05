import { ForbiddenException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import type { PrismaService } from "../../../prisma/prisma.service"

export function privateProjectWhere(userId: number): Prisma.ProjectWhereInput {
  return { OR: [{ owner_id: userId }, { participations: { some: { user_id: userId, status: "accepted" } } }] }
}

/** SQL selection keeps aggregate reads authorized without loading every Project ID. */
export function privateProjectIdsSql(userId: number) {
  return Prisma.sql`SELECT project.id FROM projects project WHERE project.owner_id=${userId}
    OR EXISTS (SELECT 1 FROM project_participations participant
      WHERE participant.project_id=project.id AND participant.user_id=${userId} AND participant.status='accepted')`
}

export type ProjectEntryAccess = {
  project_id?: number | null
  room_id?: number | null
  creation_origin?: string | null
  user_id?: number | null
  status?: string
}

/** Project association alone never changes a legacy circle post's audience. */
export function isProjectEntry(post: ProjectEntryAccess | null | undefined): boolean {
  return Boolean(post?.project_id && !post.room_id &&
    ["project_material", "project_feedback"].includes(post.creation_origin ?? ""))
}

export async function canViewProject(prisma: Pick<PrismaService, "project">, projectId: number, userId: number): Promise<boolean> {
  if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(userId) || userId <= 0) return false
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { owner_id: true, participations: { where: { user_id: userId, status: "accepted" }, select: { id: true } } },
  })
  return Boolean(project && (project.owner_id === userId || project.participations.length))
}

export async function canEditProjectEntry(prisma: Pick<PrismaService, "project">, post: ProjectEntryAccess | null | undefined, userId: number): Promise<boolean> {
  return Boolean(isProjectEntry(post) && post?.creation_origin === "project_material" &&
    post.status !== "deleted" && post.user_id === userId && await canViewProject(prisma, post.project_id!, userId))
}

export async function canReadProjectEntry(prisma: Pick<PrismaService, "project">, post: ProjectEntryAccess | null | undefined, userId: number): Promise<boolean> {
  return Boolean(isProjectEntry(post) && post?.status !== "deleted" &&
    (post?.status === "published" || (post?.status === "draft" && post.user_id === userId)) &&
    await canViewProject(prisma, post.project_id!, userId))
}

/** Project precedes participation and Entry locks for every transactional writer. */
export async function lockProjectAccess(tx: Prisma.TransactionClient, projectId: number, userId: number) {
  // Entry saves also update Project activity; avoid shared-to-exclusive lock upgrades.
  await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM project_participations WHERE project_id = ${projectId} AND user_id = ${userId} FOR SHARE`
  if (!(await canViewProject(tx, projectId, userId))) throw new ForbiddenException("Project access is required")
}

export async function lockProjectEntryEditAccess(tx: Prisma.TransactionClient, post: ProjectEntryAccess, userId: number) {
  if (!isProjectEntry(post)) throw new ForbiddenException("Project access is required")
  await lockProjectAccess(tx, post.project_id!, userId)
  if (!(await canEditProjectEntry(tx, post, userId))) throw new ForbiddenException("Project access is required")
}
