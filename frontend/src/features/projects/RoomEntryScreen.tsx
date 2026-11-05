import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { ProjectSelectionList } from "./ProjectSelectionList";
import { RoomIcon } from "../../components/RoomIcon";
import { Icon } from "../../components/Icon";
import { useManagedRoom } from "../../hooks/useRoomManagement";
import { useRoomIdentityPreview } from "../../hooks/useRoomIdentityPreview";
import { PageScrollView } from "../../components/PageScrollView";
import { ViewportShell } from "../../components/ViewportShell";
import { useProjects, useProject, useProjectEntry } from "../../hooks/useProjects";
import { useProjectCreation } from "../../hooks/useProjectCreation";
import { useRoomEntryPublication } from "../../hooks/useRoomEntryPublication";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { useDraftNavigation } from "../../hooks/useDraftNavigation";
import type { ProjectSummary } from "../../lib/api/projects";
import { ProjectEntryEditing } from "./ProjectEntryScreen";
import type { ShareProjectEntryInput } from "../../lib/api/projectEntries";
import type { EntryContentPolicy } from "../../lib/entryContentPolicy";
import { layout } from "../../styles/layout";
import { randomUuid } from "../../lib/randomId";

export function RoomEntryScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  return <RoomEntryFlow room={roomId} />;
}
export function RoomEntryFlow({ room: roomId, done, policy, context, shareInput }: { room: string; done?: () => void; policy?: EntryContentPolicy; context?: ReactNode; shareInput?: ShareProjectEntryInput }) {
  const identity = useRoomIdentityPreview(roomId);
  const roomQuery = useManagedRoom(roomId).room;
  const roomName = roomQuery.data?.name || identity.name;
  const avatar = roomQuery.data?.avatar_url ?? identity.avatar;
  const backLabel = shareInput?.round_id ? "Back to Round" : `Back to ${roomName}`;
  const params = useLocalSearchParams<{ sourceProject?: string; sourceEntry?: string; sourceRequest?: string }>();
  const router = useRouter();
  const requestKey = useRef(randomUuid()).current;
  useEffect(() => {
    if (!params.sourceRequest) router.setParams({ sourceRequest: requestKey });
  }, [params.sourceRequest, requestKey, router]);
  const projects = useProjects();
  const sourceProject = useProject(params.sourceProject);
  const creation = useProjectCreation(undefined, params.sourceRequest);
  const navigation = useRoomNavigation();
  const [choice, setChoice] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  useDraftNavigation({ dirty: false, busy: creation.isMutating, save: async () => {}, onError: setError });
  const leave = () => done ? done() : navigation.returnTo(`/app/rooms/${roomId}`);
  const owned = projects.data?.projects.filter(item => item.viewer_participation === "owner") || [];
  async function start() {
    if (pending.current) return;
    pending.current = true;
    setError(undefined);
    try {
      const selected = choice === "new" ? await creation.submit({ name: name.trim() || "Untitled" }) : owned.find(item => String(item.id) === choice);
      if (!selected) throw new Error("Choose one of your projects first.");
      if (choice === "new") await projects.mutate();
      router.setParams({ sourceProject: String(selected.id) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open your project. Try again."); }
    finally { pending.current = false; }
  }
  const selectedProject = !sourceProject.error && String(sourceProject.data?.id) === params.sourceProject && sourceProject.data?.viewer_participation === "owner" ? sourceProject.data : undefined;
  if (params.sourceProject && !selectedProject) return <ViewportShell><View style={[layout.content, layout.section]}>
    {sourceProject.isLoading ? <ActivityIndicator accessibilityLabel="Opening your project" /> : <>
      <Text accessibilityRole="alert" style={layout.text}>This private project is unavailable. Your work has not been moved or replaced.</Text>
      <Button onPress={() => void sourceProject.mutate()}>Try again</Button>
      <Button emphasis="link" onPress={leave}>{backLabel}</Button>
    </>}
  </View></ViewportShell>;
  if (selectedProject) return <RoomEntryEditing key={selectedProject.id} room={roomId} roomName={roomName} avatar={avatar} project={selectedProject} done={done} policy={policy} context={context} shareInput={shareInput} />;
  return <ViewportShell>
    <View style={[layout.content, layout.appBar]}>
      <Button size="icon" emphasis="bare" accessibilityLabel={backLabel} onPress={leave}><Icon name="caretLeft" size={24} /></Button>
      <Text accessibilityRole="header" numberOfLines={1} style={layout.appBarTitle}>{`Share in ${roomName}`}</Text>
    </View>
    <PageScrollView contentContainerStyle={[layout.content, layout.section]}>
    {context}
    <ProjectSelectionList projects={projects} selected={choice} onSelect={setChoice} disabled={creation.isMutating} />
    <Button emphasis="outline" disabled={creation.isMutating} onPress={() => setChoice("new")}>Create a project</Button>
    {choice === "new" && <Input accessibilityLabel="Project name (optional)" placeholder="Project name (optional)" value={name} onChangeText={setName} editable={!creation.isMutating} />}
    {choice === "new" && <Text style={layout.muted}>Leave the name blank to create Untitled.</Text>}
    {error && <Text accessibilityRole="alert" style={layout.text}>{error}</Text>}
    <Button disabled={!params.sourceRequest || !choice || creation.isMutating || Boolean(projects.error)} onPress={() => void start()}>Continue</Button>
    <Button emphasis="link" disabled={creation.isMutating} onPress={leave}>{backLabel}</Button>
  </PageScrollView></ViewportShell>;
}
function RoomEntryEditing({ room, roomName, avatar, project, done, policy, context, shareInput }: { room: string; roomName: string; avatar?: string | null; project: ProjectSummary; done?: () => void; policy?: EntryContentPolicy; context?: ReactNode; shareInput?: ShareProjectEntryInput }) {
  const backLabel = shareInput?.round_id ? "Back to Round" : `Back to ${roomName}`;
  const { sourceEntry, shareStarted, sourceRequest } = useLocalSearchParams<{ sourceEntry?: string; shareStarted?: string; sourceRequest?: string }>();
  const router = useRouter();
  const entry = useProjectEntry(String(project.id), sourceEntry, !sourceEntry && Boolean(sourceRequest), sourceRequest);
  useEffect(() => {
    if (!sourceEntry && entry.query.data?.id) router.setParams({ sourceEntry: String(entry.query.data.id) });
  }, [sourceEntry, entry.query.data?.id, router]);
  const publication = useRoomEntryPublication(String(project.id), entry.query.data?.id || 0, room,
    `room-entry-${project.id}-${sourceEntry}-${room}-${shareInput?.round_id || "room"}-${shareInput?.creation_origin || "entry"}`);
  const sharingStarted = publication.prepared || shareStarted === "1";
  const navigation = useRoomNavigation();
  if (!entry.query.data || !sourceEntry || entry.query.error || !entry.query.data.can_edit) return <ViewportShell><View style={[layout.content, layout.section]}>
    {entry.query.error || (entry.query.data && !entry.query.data.can_edit) ? <><Text accessibilityRole="alert" style={layout.text}>This private work is unavailable for editing. It has not been moved or replaced.</Text><Button onPress={() => void entry.query.mutate()}>Try again</Button></> : <ActivityIndicator accessibilityLabel="Opening your work" />}
    <Button emphasis="link" onPress={() => done ? done() : navigation.returnTo(`/app/rooms/${room}`)}>{backLabel}</Button>
  </View></ViewportShell>;
  return <ProjectEntryEditing room={room} projectId={String(project.id)} name={roomName} headingIcon={<RoomIcon name={roomName} avatarUrl={avatar} size={24} />} entry={entry.query.data} save={entry.save}
    backLabel={backLabel} completionLabel={shareInput?.round_id ? "Submit Round contribution" : `Share in ${roomName}`} returnPath={`/app/rooms/${room}`} onPublish={async () => { router.setParams({ shareStarted: "1" }); await publication.publish(shareInput); }} onFinished={done} policy={policy} editingLocked={sharingStarted}
    projectControl={context} />;
}
