import { Controller, Get, Post, Delete, Inject, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { AgentConnectionsService } from './agent-connections.service'
import { captureTriggers, captureAcquisitions, captureSources } from '../../../../types/capture-analytics'

@Controller('api/mcp')
export class McpController {
  @Inject(AgentConnectionsService) private readonly agents!: AgentConnectionsService
  @Get() get(@Res() response: Response) { response.status(405).set('Allow', 'POST').end() }
  @Delete() delete(@Res() response: Response) { response.status(405).set('Allow', 'POST').end() }
  @Post() async handle(@Req() request: Request, @Res() response: Response) {
    // Native/CLI clients send no Origin. Browser clients must be same-origin.
    if (request.headers.origin && request.headers.origin !== `${request.protocol}://${request.get('host')}`) {
      response.status(403).json({ error: 'Cross-origin MCP requests are not allowed' }); return
    }
    const grant = await this.agents.authenticate(request.headers.authorization)
    const server = new McpServer({ name: 'a-fire', version: '0.1.0' }, { instructions:
      'Preserve creative work without generating commentary. This connection can only save links to its authorized Project. It cannot share to Rooms. Reuse the same operation_id when retrying. Never change source_version to bypass a suppressed capture. URLs are references, not archived websites. No monitoring schedule is created by connecting.' })
    const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
    server.registerTool('get_capture_project', { description: 'Read the Project and audience authorized for this connection.', annotations: { readOnlyHint: true } }, async () => result(await this.agents.project(grant)))
    server.registerTool('save_link', { description: 'Save a supplied HTTP(S) link as a private Project entry. No generated captions. No Room sharing.',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: { operation_id: z.string().uuid(), url: z.string().max(4096), source_version: z.string().min(1).max(200).optional(),
        trigger: z.enum(captureTriggers).optional(), acquisition: z.enum(captureAcquisitions).optional(), source: z.enum(captureSources).optional() },
    }, async input => result(await this.agents.saveLink(grant, input)))
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    response.once('close', () => { void server.close().catch(() => {}) })
    await server.connect(transport)
    await transport.handleRequest(request, response, request.body)
  }
}
