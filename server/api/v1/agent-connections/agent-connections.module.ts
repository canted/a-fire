import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { ProjectsModule } from '../projects/projects.module'
import { AgentConnectionsService } from './agent-connections.service'
import { AgentConnectionsController } from './agent-connections.controller'
import { McpController } from './mcp.controller'
@Module({ imports: [AuthModule, ProjectsModule], providers: [AgentConnectionsService], controllers: [AgentConnectionsController, McpController] })
export class AgentConnectionsModule {}
