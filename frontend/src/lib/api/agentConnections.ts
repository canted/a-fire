import type { SessionTransport } from './transport';
type Client = Pick<SessionTransport, 'get' | 'post' | 'delete'>;
export type AgentConnection = { id: string; project_id: number; name: string; reporting_consent: boolean; expires_at: string; revoked_at: string | null };
export type NewAgentConnection = { project_id: number; name: string; reporting_consent: boolean };
export const listAgentConnections = (client: Client) => client.get<AgentConnection[]>('/v1/agent-connections');
export const createAgentConnection = (client: Client, input: NewAgentConnection) => client.post<{ id: string; token: string; expires_at: string }>('/v1/agent-connections', input);
export const revokeAgentConnection = (client: Client, id: string) => client.delete(`/v1/agent-connections/${encodeURIComponent(id)}`);
