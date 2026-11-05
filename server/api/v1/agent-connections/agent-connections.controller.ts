import { Body, Controller, Delete, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common'
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard'
import { AgentConnectionsService } from './agent-connections.service'

@Controller('api/v1/agent-connections')
@UseGuards(AuthGuard)
export class AgentConnectionsController {
  @Inject(AgentConnectionsService) private readonly agents!: AgentConnectionsService
  @Get() list(@Req() request: AuthenticatedRequest) { return this.agents.list(request.user.id) }
  @Post() create(@Req() request: AuthenticatedRequest, @Body() body: { project_id?: unknown; name?: unknown; reporting_consent?: unknown }) {
    return this.agents.create(request.user.id, body)
  }
  @Delete(':id') revoke(@Req() request: AuthenticatedRequest, @Param('id') id: string) { return this.agents.revoke(request.user.id, id) }
}
