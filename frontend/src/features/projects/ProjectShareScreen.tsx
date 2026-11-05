import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { PopupMenu } from "../../components/PopupMenu";
import { ViewportShell } from "../../components/ViewportShell";
import { EntryContent } from "../content/EntryContent";
import { ProjectShare } from "./ProjectShare";
import { useProjectEntry } from "../../hooks/useProjects";
import { usePreparedEntryShare } from "../../hooks/useProjectShare";
import { useRoomEntryPublication } from "../../hooks/useRoomEntryPublication";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { useEntryDraft } from "../../hooks/useEntryDraft";
import { randomUuid } from "../../lib/randomId";
import type { PreparedEntryShare } from "../../lib/api/projectEntries";
import { layout } from "../../styles/layout";

/** A durable request address recovers the recipient copy, never a rebuilt source. */
export function ProjectShareScreen() {
  const { projectId, entryId, room, request, preview } = useLocalSearchParams<{ projectId: string; entryId: string; room?: string; preview?: string; request?: string }>();
  const router = useRouter();
  const navigation = useRoomNavigation();
  const generated = useRef(randomUuid());
  useEffect(() => { if (!request) router.setParams({ request: generated.current }); }, [request, router]);
  const source = useProjectEntry(projectId, entryId);
  const recovery = usePreparedEntryShare(projectId, entryId, request);
  const close = () => navigation.returnTo(room ? `/app/rooms/${room}` : `/app/projects/${projectId}`);
  const finish = (destination: string) => router.replace(`/app/rooms/${destination}`);
  if (!request || source.query.isLoading || recovery.isLoading) return <ViewportShell><ActivityIndicator accessibilityLabel="Opening shared entry" /></ViewportShell>;
  if (source.query.error || recovery.error || !source.query.data) return <ViewportShell><View style={[layout.content, layout.section]}>
    <Text accessibilityRole="alert" style={layout.text}>Could not reopen this share. Your saved copy has not been replaced.</Text>
    <Button onPress={() => void Promise.allSettled([source.query.mutate(), recovery.mutate()])}>Try again</Button>
    <Button emphasis="link" onPress={close}>Back</Button>
  </View></ViewportShell>;
  return <ViewportShell>{recovery.data
    ? <PreparedShare key={recovery.data.entry_id} project={projectId} entry={entryId} prepared={recovery.data} close={close} finish={finish} />
    : <ProjectShare preview={preview === "1" && Boolean(room)} projectId={projectId} entry={source.query.data} initialRoom={room} requestKey={request} onClose={close} onShared={finish} onShareError={() => { void recovery.mutate().catch(() => {}); }} />
  }</ViewportShell>;
}
function PreparedShare({ project, entry, prepared, close, finish }: { project: string; entry: string; prepared: PreparedEntryShare; close: () => void; finish: (room: string) => void }) {
  const preview = useEntryDraft({ existing: String(prepared.entry_id) });
  const publication = useRoomEntryPublication(project, Number(entry), String(prepared.room_id), undefined, prepared);
  const [error, setError] = useState<string>();
  const submit = async () => {
    try { setError(undefined); await publication.publish(); finish(String(prepared.room_id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not finish sharing. Try again."); }
  };
  return <PopupMenu mode="dialog" open title="Resume sharing" actions={[]} onClose={close} dismissDisabled={publication.busy}
    footer={<Button disabled={!preview.draft.data || Boolean(preview.draft.error) || publication.busy} onPress={() => void submit()}>{publication.busy ? "Sharing…" : "Finish sharing"}</Button>}>
    <View style={layout.section}>
      <Text style={layout.text}>This is the copy you prepared. Finishing uses this same copy and keeps your private Project unchanged.</Text>
      {preview.draft.isLoading && <ActivityIndicator accessibilityLabel="Loading prepared copy" />}
      {preview.draft.error && <Button onPress={() => void preview.draft.mutate()}>Retry prepared copy</Button>}
      {preview.draft.data && <EntryContent entry={{ content: preview.draft.data.content, format: preview.draft.data.format, format_data: preview.draft.data.format_data ?? null, room_statement: preview.draft.data.room_statement, shared_feedback: preview.draft.data.shared_feedback }} interactive={false} />}
      {error && <Text accessibilityRole="alert" style={layout.text}>{error}</Text>}
    </View>
  </PopupMenu>;
}
