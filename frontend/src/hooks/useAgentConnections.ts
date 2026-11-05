import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { client } from '../lib/api';
import { listAgentConnections, createAgentConnection, revokeAgentConnection, type NewAgentConnection } from '../lib/api/agentConnections';
export function useAgentConnections() {
  const query = useSWR('agent-connections', () => listAgentConnections(client));
  const create = useSWRMutation('agent-connections', async (_, { arg }: { arg: NewAgentConnection }) => {
    const result = await createAgentConnection(client, arg);
    void query.mutate().catch(() => {});
    return result;
  }, { populateCache: false });
  const revoke = useSWRMutation('agent-connections', async (_, { arg }: { arg: string }) => {
    await revokeAgentConnection(client, arg);
    await query.mutate();
  });
  return { query, create, revoke };
}
