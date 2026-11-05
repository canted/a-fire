import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { createHash, randomBytes } from 'node:crypto'
import { PrismaService } from '../../../prisma/prisma.service'
import { canViewProject } from '../projects/project-access'
import { ProjectEntriesService } from '../projects/project-entries.service'
import { captureExperimentOutcome } from '../../../runtime/capture-analytics'
import { captureTriggers, captureAcquisitions, captureSources } from '../../../../types/capture-analytics'
import type { AgentConnection } from '@prisma/client'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export type LinkCapture = { operation_id: string; url: string; source_version?: string;
  trigger?: typeof captureTriggers[number]; acquisition?: typeof captureAcquisitions[number]; source?: typeof captureSources[number] }

/** No URL fetching: protected links are references, not credentials or archived sites. */
export function captureLinkIdentity(input: LinkCapture) {
  if (!input || !uuid.test(input.operation_id)) throw new BadRequestException('Use a UUID operation_id')
  let url: URL
  try { url = new URL(input.url) } catch { throw new BadRequestException('Provide an HTTP or HTTPS link') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 4096) throw new BadRequestException('Provide an HTTP or HTTPS link without embedded credentials')
  if (input.source_version !== undefined && (typeof input.source_version !== 'string' || !input.source_version.trim() || input.source_version.length > 200)) throw new BadRequestException('Invalid source version')
  if ((input.trigger !== undefined && !captureTriggers.includes(input.trigger)) ||
      (input.acquisition !== undefined && !captureAcquisitions.includes(input.acquisition)) ||
      (input.source !== undefined && !captureSources.includes(input.source))) throw new BadRequestException('Invalid workflow metadata')
  return { url: url.href, sourceHash: hash(JSON.stringify([url.href, input.source_version ?? 'reference'])) }
}

@Injectable()
export class AgentConnectionsService {
  @Inject(PrismaService) private readonly prisma!: PrismaService
  @Inject(ProjectEntriesService) private readonly entries!: ProjectEntriesService

  async list(userId: number) {
    return this.prisma.agentConnection.findMany({ where: { user_id: userId }, select: {
      id: true, project_id: true, name: true, reporting_consent: true, expires_at: true, revoked_at: true, created_at: true,
    }, orderBy: { created_at: 'desc' } })
  }

  async create(userId: number, input: { project_id?: unknown; name?: unknown; reporting_consent?: unknown }) {
    if (!Number.isSafeInteger(input?.project_id) || Number(input.project_id) <= 0 ||
        typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80 ||
        typeof input.reporting_consent !== 'boolean') throw new BadRequestException('Choose a Project, connection name and reporting preference')
    const projectId = Number(input.project_id)
    if (!await canViewProject(this.prisma, projectId, userId)) throw new ForbiddenException('Project access is required')
    const token = `afire_agent_${randomBytes(32).toString('base64url')}`
    const connection = await this.prisma.agentConnection.create({ data: { user_id: userId, project_id: projectId,
      name: input.name.trim(), token_hash: hash(token), reporting_consent: input.reporting_consent,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }, select: { id: true, expires_at: true } })
    return { ...connection, token }
  }

  async revoke(userId: number, id: string) {
    await this.prisma.agentConnection.updateMany({ where: { id, user_id: userId, revoked_at: null }, data: { revoked_at: new Date() } })
    return { success: true }
  }

  async authenticate(header?: string): Promise<AgentConnection> {
    if (!header?.startsWith('Bearer afire_agent_') || header.length > 200) throw new UnauthorizedException('Agent connection required')
    const grant = await this.prisma.agentConnection.findUnique({ where: { token_hash: hash(header.slice(7)) } })
    if (!grant || grant.revoked_at || grant.expires_at <= new Date()) throw new UnauthorizedException('Agent connection expired or revoked')
    if (!await canViewProject(this.prisma, grant.project_id, grant.user_id)) throw new ForbiddenException('Project access is required')
    return grant
  }

  async project(grant: AgentConnection) {
    if (!await canViewProject(this.prisma, grant.project_id, grant.user_id)) throw new ForbiddenException('Project access is required')
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: grant.project_id }, select: { id: true, name: true } })
    return { ...project, audience: 'Project owner and accepted collaborators', capabilities: ['save_link'], room_sharing: false }
  }

  async saveLink(grant: AgentConnection, input: LinkCapture) {
    const identity = captureLinkIdentity(input)
    const fingerprint = hash(JSON.stringify([grant.project_id, identity.sourceHash]))
    // Commit the source/request binding before entry allocation; recovery uses its stable key.
    const receipt = await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${grant.user_id}::integer, hashtext(${input.operation_id}))`
      const previous = await tx.agentCaptureOperation.findUnique({ where: { user_id_operation_id: { user_id: grant.user_id, operation_id: input.operation_id } } })
      if (previous && previous.fingerprint !== fingerprint) throw new ConflictException('This operation ID belongs to a different capture')
      // Different operation IDs can capture the same source concurrently. Serialize
      // that identity before Prisma's read/create upsert, as well as the operation.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([grant.user_id, grant.project_id, identity.sourceHash])}, 0))`
      const receipt = await tx.agentCaptureReceipt.upsert({ where: { user_id_project_id_source_hash: {
        user_id: grant.user_id, project_id: grant.project_id, source_hash: identity.sourceHash,
      } }, create: { user_id: grant.user_id, project_id: grant.project_id, source_hash: identity.sourceHash }, update: {} })
      if (!previous) await tx.agentCaptureOperation.create({ data: { user_id: grant.user_id, operation_id: input.operation_id, fingerprint, receipt_id: receipt.id } })
      return receipt
    })
    const result = await this.prisma.$transaction(async tx => {
      // Independent entry-service transactions retain their canonical Project locks.
      // This lock only serializes this receipt, not Project rows or human drafts.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${receipt.id}, 0))`
      const connections = await tx.$queryRaw<AgentConnection[]>`SELECT * FROM agent_connections WHERE id = ${grant.id} FOR SHARE`
      const currentGrant = connections[0]
      if (!currentGrant || currentGrant.revoked_at || currentGrant.expires_at <= new Date()) throw new UnauthorizedException('Agent connection expired or revoked')
      if (!await canViewProject(tx as unknown as PrismaService, grant.project_id, grant.user_id)) throw new ForbiddenException('Project access is required')
      const currentReceipt = await tx.agentCaptureReceipt.findUniqueOrThrow({ where: { id: receipt.id } })
      const requestKey = `agent_${receipt.id}`
      let entry = await this.prisma.entry.findUnique({ where: { user_id_creation_request_key: { user_id: grant.user_id, creation_request_key: requestKey } } })
      if (!entry && currentReceipt.entry_id) return { outcome: 'suppressed_deleted' as const }
      if (entry?.status === 'deleted') return { outcome: 'suppressed_deleted' as const }
      if (entry && entry.project_id !== grant.project_id) return { outcome: 'suppressed_moved' as const }
      if (entry?.status === 'published') return { outcome: 'duplicate' as const, entry_id: entry.id, path: `/app/projects/${grant.project_id}/entries/${entry.id}` }
      if (!entry) {
        const allocated = await this.entries.create(grant.project_id, grant.user_id, { request_key: requestKey })
        entry = await this.prisma.entry.findUniqueOrThrow({ where: { id: allocated.id } })
      }
      await this.prisma.agentCaptureReceipt.update({ where: { id: receipt.id }, data: { entry_id: entry.id } })
      // Set provenance before publication; retries cannot publish without the marker.
      await this.prisma.entry.update({ where: { id: entry.id }, data: { automated_creation: true } })
      await this.entries.update(grant.project_id, entry.id, grant.user_id, { expected_revision: entry.updated_at.getTime(), save: true,
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: identity.url, marks: [{ type: 'link', attrs: { href: identity.url } }] }] }] } })
      return { outcome: 'saved' as const, entry_id: entry.id, path: `/app/projects/${grant.project_id}/entries/${entry.id}` }
    }, { timeout: 30000 })
    // Optional descriptive fields are never fabricated for agent calls that omit them.
    if (input.trigger && input.source) captureExperimentOutcome(grant.user_id, grant.reporting_consent, {
      attempt_id: input.operation_id, project_id: grant.project_id, ...result,
      trigger: input.trigger, source: input.source, acquisition: input.acquisition, artifact_count: 1,
    })
    return result
  }
}
