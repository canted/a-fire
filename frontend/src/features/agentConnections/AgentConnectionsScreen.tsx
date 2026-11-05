import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { PageScrollView } from '../../components/PageScrollView';
import { ViewportShell } from '../../components/ViewportShell';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { useAgentConnections } from '../../hooks/useAgentConnections';
import { useProjects } from '../../hooks/useProjects';
import { useRoomNavigation } from '../../hooks/useRoomNavigation';
import { apiBaseUrl } from '../../lib/api';
import { layout } from '../../styles/layout';

export function AgentConnectionsScreen() {
  const agents = useAgentConnections();
  const projects = useProjects();
  const navigation = useRoomNavigation();
  const [projectId, setProjectId] = useState<number>();
  const [name, setName] = useState('My Codex');
  const [reporting, setReporting] = useState(false);
  const [key, setKey] = useState<{ id: string; token: string }>();
  const [error, setError] = useState<string>();
  const busy = agents.create.isMutating || agents.revoke.isMutating;
  const project = projects.data?.projects.find(item => item.id === projectId);
  const available = projects.data?.projects.filter(item => item.viewer_participation === 'owner' || item.viewer_participation === 'accepted') ?? [];
  return <ViewportShell><PageScrollView contentContainerStyle={layout.section}>
    <Button emphasis="link" onPress={() => navigation.returnTo()}>Back</Button>
    <Text accessibilityRole="header" style={layout.appBarTitle}>Agent connections</Text>
    <Text style={layout.text}>Let your agent save links to one Project. Room sharing and monitoring are not enabled by this connection.</Text>
    <Input accessibilityLabel="Connection name" value={name} onChangeText={setName} maxLength={80} />
    <Text style={layout.text}>Choose a Project</Text>
    {projects.isLoading && <ActivityIndicator accessibilityLabel="Loading Projects" />}
    {projects.error && <Button onPress={() => { void projects.mutate().catch(() => {}); }}>Retry loading Projects</Button>}
    {available.map(item => <Button key={item.id} selected={projectId === item.id} emphasis="outline" disabled={busy} onPress={() => setProjectId(item.id)}>{item.name}</Button>)}
    {!projects.isLoading && !projects.error && available.length === 0 && <Text style={layout.muted}>Join or create a Project before connecting an agent.</Text>}
    {projects.hasMore && <Button onPress={() => { void projects.loadMore(); }}>More Projects</Button>}
    {project && <Text style={layout.muted}>Entries will be visible to {project.owner.username}{project.participants.length ? ` and ${project.participants.length} accepted collaborator(s)` : ''}. They will not be shared to a Room.</Text>}
    <Button emphasis="outline" accessibilityRole="switch" checked={reporting} accessibilityLabel="Share pilot workflow statistics" onPress={() => setReporting(!reporting)}>{reporting ? '✓ ' : ''}Share pilot workflow statistics</Button>
    <Text style={layout.muted}>Optional: report whether a capture came from a request, reminder or monitoring, how it was acquired, and whether it succeeded. Artwork, link addresses and filenames are excluded.</Text>
    <Button disabled={busy || !project || !name.trim() || Boolean(key)} onPress={() => {
      setError(undefined);
      void agents.create.trigger({ project_id: projectId!, name: name.trim(), reporting_consent: reporting }).then(setKey).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not create connection'));
    }}>{agents.create.isMutating ? 'Creating…' : 'Create connection key'}</Button>
    {key && <View style={layout.section}>
      <Text style={layout.text}>Shown once. Store this key privately in your agent’s connection settings. It expires in 30 days.</Text>
      <Text selectable style={layout.text}>{key.token}</Text>
      <Text style={layout.muted}>Connect to {apiBaseUrl.replace(/\/api\/?$/, '')}/api/mcp using bearer-token authentication. This is a pilot connection; OAuth sign-in is not available yet.</Text>
      <Button emphasis="outline" onPress={() => { setKey(undefined); agents.create.reset(); }}>I have stored the key</Button>
    </View>}
    {error && <Text accessibilityRole="alert" style={layout.text}>{error}</Text>}
    <Text accessibilityRole="header" style={layout.appBarTitle}>Your connections</Text>
    {agents.query.isLoading && <ActivityIndicator accessibilityLabel="Loading connections" />}
    {agents.query.error && <Button onPress={() => { void agents.query.mutate().catch(() => {}); }}>Retry loading connections</Button>}
    {agents.query.data?.map(connection => <View key={connection.id} style={layout.section}>
      <Text style={layout.text}>{connection.name} · {connection.revoked_at ? 'Disconnected' : new Date(connection.expires_at) <= new Date() ? 'Expired' : `Expires ${new Date(connection.expires_at).toLocaleDateString()}`}</Text>
      {!connection.revoked_at && <Button emphasis="outline" disabled={busy} onPress={() => {
        setError(undefined);
        void agents.revoke.trigger(connection.id).then(() => { if (key?.id === connection.id) { setKey(undefined); agents.create.reset(); } }).catch(() => setError('Could not disconnect. Try again.'));
      }}>Disconnect</Button>}
    </View>)}
  </PageScrollView></ViewportShell>;
}
