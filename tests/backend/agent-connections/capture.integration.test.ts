import 'reflect-metadata'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../../../server/prisma/prisma.service'
import { ProjectEntriesService } from '../../../server/api/v1/projects/project-entries.service'
import { AgentConnectionsService, captureLinkIdentity } from '../../../server/api/v1/agent-connections/agent-connections.service'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpController } from '../../../server/api/v1/agent-connections/mcp.controller'
import { AuthService } from '../../../server/api/v1/auth/auth.service'

const prisma = new PrismaService()
const entries = new ProjectEntriesService()
const agents = new AgentConnectionsService()
let userId: number, projectId: number, otherProjectId: number
let token: string, connectionId: string
beforeAll(async () => {
  Object.assign(entries, { prisma, uploads: { assertContentMediaAccess: async () => {} } })
  Object.assign(agents, { prisma, entries })
  const now = new Date()
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@agent-capture.test`, username: 'Capture pilot', created_at: now, updated_at: now } })
  userId = user.id
  projectId = (await prisma.project.create({ data: { owner_id: userId, name: 'Capture', created_at: now, updated_at: now } })).id
  otherProjectId = (await prisma.project.create({ data: { owner_id: userId, name: 'Other', created_at: now, updated_at: now } })).id
  const created = await agents.create(userId, { name: 'Codex', project_id: projectId, reporting_consent: false })
  token = created.token; connectionId = created.id
})
afterAll(async () => {
  const ids = (await prisma.entry.findMany({ where: { user_id: userId }, select: { id: true } })).map(item => item.id)
  await prisma.document.deleteMany({ where: { docable_type: 'Post', docable_id: { in: ids } } })
  await prisma.agentCaptureOperation.deleteMany({ where: { user_id: userId } })
  await prisma.agentCaptureReceipt.deleteMany({ where: { user_id: userId } })
  await prisma.agentConnection.deleteMany({ where: { user_id: userId } })
  await prisma.entry.deleteMany({ where: { user_id: userId } })
  await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId] } } })
  await prisma.user.delete({ where: { id: userId } })
  await prisma.$disconnect()
})

it('hashes connection keys and keeps them separate from ordinary user tokens', async () => {
  const stored = await prisma.agentConnection.findUniqueOrThrow({ where: { id: connectionId } })
  expect(stored.token_hash).not.toContain(token)
  expect(JSON.stringify(await agents.list(userId))).not.toContain(stored.token_hash)
  expect(() => new AuthService().verifyAccessToken(token)).toThrow()
  await expect(agents.authenticate('Bearer invalid')).rejects.toThrow()
  const grant = await agents.authenticate(`Bearer ${token}`)
  expect(await agents.project(grant)).toMatchObject({ id: projectId, room_sharing: false })
  await expect(agents.create(userId + 1000000, { name: 'Denied', project_id: projectId, reporting_consent: false })).rejects.toThrow('Project access')
})

it('saves through the canonical entry service, leaves human drafts alone and serializes duplicates', async () => {
  const human = await entries.create(projectId, userId)
  const grant = await agents.authenticate(`Bearer ${token}`)
  const input = { operation_id: randomUUID(), url: 'https://example.org/art' }
  const results = await Promise.all([agents.saveLink(grant, input), agents.saveLink(grant, input), agents.saveLink(grant, { ...input, operation_id: randomUUID() })])
  expect(results.filter(item => item.outcome === 'saved')).toHaveLength(1)
  const saved = results.find(item => item.outcome === 'saved')!
  expect(new Set(results.map(item => item.entry_id)).size).toBe(1)
  expect(saved.entry_id).not.toBe(human.id)
  expect(await prisma.entry.findUnique({ where: { id: saved.entry_id } })).toMatchObject({ status: 'published', room_id: null, automated_creation: true })
  expect(await entries.show(projectId, saved.entry_id!, userId)).toMatchObject({ automated_creation: true })
  expect(await prisma.entry.findUnique({ where: { id: human.id } })).toMatchObject({ status: 'draft', automated_creation: false })
  await expect(agents.saveLink(grant, { ...input, url: 'https://example.org/different' })).rejects.toThrow('different capture')
  const current = await prisma.entry.findUniqueOrThrow({ where: { id: saved.entry_id } })
  await entries.changeLocation(projectId, current.id, userId, current.updated_at.getTime(), null)
  expect(await agents.saveLink(grant, { ...input, operation_id: randomUUID() })).toEqual({ outcome: 'suppressed_deleted' })
  expect((await agents.saveLink(grant, { ...input, source_version: 'new-artwork', operation_id: randomUUID() })).outcome).toBe('saved')
})

it('resumes after a save succeeds but its caller loses the response without overwriting human edits', async () => {
  const grant = await agents.authenticate(`Bearer ${token}`)
  const input = { operation_id: randomUUID(), url: 'https://example.org/recovery' }
  const original = entries.update.bind(entries)
  entries.update = async (...args) => { await original(...args); throw new Error('Lost response') }
  try { await expect(agents.saveLink(grant, input)).rejects.toThrow('Lost response') } finally { entries.update = original }
  const receipt = await prisma.agentCaptureReceipt.findUniqueOrThrow({ where: { user_id_project_id_source_hash: { user_id: userId, project_id: projectId, source_hash: captureLinkIdentity(input).sourceHash } } })
  const post = await prisma.entry.findUniqueOrThrow({ where: { user_id_creation_request_key: { user_id: userId, creation_request_key: `agent_${receipt.id}` } } })
  await entries.update(projectId, post.id, userId, { expected_revision: post.updated_at.getTime(), intent: 'Human title' })
  expect(await agents.saveLink(grant, input)).toMatchObject({ outcome: 'duplicate', entry_id: post.id })
  expect((await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).project_intent).toBe('Human title')
  const current = await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })
  await entries.changeLocation(projectId, post.id, userId, current.updated_at.getTime(), otherProjectId)
  expect(await agents.saveLink(grant, { ...input, operation_id: randomUUID() })).toEqual({ outcome: 'suppressed_moved' })
})

it('rejects expired and revoked grants, including an already-authenticated pending call', async () => {
  const grant = await agents.authenticate(`Bearer ${token}`)
  await agents.revoke(userId, connectionId)
  await expect(agents.authenticate(`Bearer ${token}`)).rejects.toThrow('revoked')
  await expect(agents.saveLink(grant, { operation_id: randomUUID(), url: 'https://example.org/denied' })).rejects.toThrow('revoked')
  const expiring = await agents.create(userId, { name: 'Expiry', project_id: projectId, reporting_consent: false })
  await prisma.agentConnection.update({ where: { id: expiring.id }, data: { expires_at: new Date(0) } })
  await expect(agents.authenticate(`Bearer ${expiring.token}`)).rejects.toThrow('expired')
})

it('rejects executable links, embedded credentials and malformed workflow data', () => {
  for (const url of ['javascript:alert(1)', 'file:///tmp/art', 'https://user:pass@example.org']) expect(() => captureLinkIdentity({ operation_id: randomUUID(), url })).toThrow()
  expect(() => captureLinkIdentity({ operation_id: 'invalid', url: 'https://example.org' })).toThrow()
  expect(() => captureLinkIdentity({ operation_id: randomUUID(), url: 'https://example.org', source: 'secret-path' as never })).toThrow()
})

it('serves the real MCP handshake and tools over HTTP with authentication and revocation', async () => {
  @Module({ controllers: [McpController], providers: [{ provide: AgentConnectionsService, useValue: agents }] })
  class PilotModule {}
  const app = await NestFactory.create(PilotModule, { logger: false })
  await app.listen(0, '127.0.0.1')
  const address = await app.getUrl()
  const credential = await agents.create(userId, { name: 'HTTP trial', project_id: projectId, reporting_consent: false })
  const client = new Client({ name: 'pilot-test', version: '1.0.0' })
  try {
    const denied = await fetch(`${address}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(denied.status).toBe(401)
    const originDenied = await fetch(`${address}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://other.example', authorization: `Bearer ${credential.token}` }, body: '{}' })
    expect(originDenied.status).toBe(403)
    await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${credential.token}` } } }))
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['get_capture_project', 'save_link'])
    const discovery = await client.callTool({ name: 'get_capture_project', arguments: {} })
    expect(JSON.parse((discovery.content as Array<{ text: string }>)[0].text)).toMatchObject({ id: projectId, room_sharing: false })
    const input = { operation_id: randomUUID(), url: 'https://example.org/http' }
    const saved = await client.callTool({ name: 'save_link', arguments: input })
    expect(saved.isError).not.toBe(true)
    expect(JSON.parse((saved.content as Array<{ text: string }>)[0].text)).toMatchObject({ outcome: 'saved' })
    const repeat = await client.callTool({ name: 'save_link', arguments: input })
    expect(JSON.parse((repeat.content as Array<{ text: string }>)[0].text)).toMatchObject({ outcome: 'duplicate' })
    const entryId = JSON.parse((saved.content as Array<{ text: string }>)[0].text).entry_id
    await prisma.document.deleteMany({ where: { docable_type: 'Post', docable_id: entryId } })
    await prisma.entry.delete({ where: { id: entryId } })
    const removed = await client.callTool({ name: 'save_link', arguments: { ...input, operation_id: randomUUID() } })
    expect(JSON.parse((removed.content as Array<{ text: string }>)[0].text)).toEqual({ outcome: 'suppressed_deleted' })
    await agents.revoke(userId, credential.id)
    await expect(client.listTools()).rejects.toThrow()
  } finally { await client.close(); await app.close() }
})
