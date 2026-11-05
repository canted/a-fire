import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { Input } from "../../components/Input";
import { RoomIcon } from "../../components/RoomIcon";
import { Select } from "../../components/Select";
import { PopupMenu } from "../../components/PopupMenu";
import { EntryContent } from "../content/EntryContent";
import { useProjectShare } from "../../hooks/useProjectShare";
import { useRoomEntryPublication } from "../../hooks/useRoomEntryPublication";
import { useContentLink } from "../../hooks/useContentLink";
import type { ProjectEntry } from "../../lib/api/projectEntries";
import type { EntryShareManifest } from "../../lib/entryShareSelection";
import { tokens } from "../../styles/tokens";
import { layout } from "../../styles/layout";

/** Selection only: previews use the production entry renderer and never edit the source. */
export function ProjectShareSelection({ manifest, selected, disabled, toggle }: {
  manifest: EntryShareManifest;
  selected: string[];
  disabled: boolean;
  toggle: (id: string) => void;
}) {
  const media = manifest.units.filter(unit => unit.kind === "media");
  const check = (checked: boolean) => <View style={[styles.check, checked && styles.checked]}>
    {checked && <Icon name="checkBold" size={12} color={tokens.paper} />}
  </View>;
  return <View style={styles.units}>
    {media.length > 0 && <EntryContent interactive={false}
      entry={{ format: "mixed_media", format_data: null, content: { type: "doc", content: media.flatMap(unit => unit.content.content ?? []) } }}
      renderMediaOverlay={(index, corners) => {
        const unit = media[index];
        const checked = unit.eligible && selected.includes(unit.id);
        return <Button emphasis="bare" checked={checked} disabled={disabled || !unit.eligible}
          accessibilityLabel={`Include media ${index + 1}`} onPress={() => toggle(unit.id)}
          style={[styles.mediaSelection, corners, checked && styles.included]}>{check(checked)}</Button>;
      }} />}
    {manifest.units.filter(unit => unit.kind !== "media").map(unit => {
      const checked = unit.eligible && selected.includes(unit.id);
      const label = unit.kind === "feedback" ? `Feedback from ${unit.authorName || "Former member"}` : unit.kind === "body" ? "Body" : "Title";
      return <View key={unit.id} style={styles.unitGroup}>
        <Button emphasis="bare" checked={checked} disabled={disabled || !unit.eligible}
          accessibilityLabel={`${label}${unit.eligible ? "" : ", unavailable in this Room"}`}
          onPress={() => toggle(unit.id)} style={[styles.unit, checked && styles.included]}>
          {unit.kind === "feedback" && <Text style={layout.muted}>{label}</Text>}
          <View pointerEvents="none" style={styles.preview}>
            <EntryContent interactive={false} entry={{ format: "mixed_media",
              format_data: unit.kind === "title" ? { title: unit.title } : null,
              content: unit.kind === "title" ? { type: "doc", content: [] } : unit.content,
            }} />
          </View>
          {unit.eligible && <View style={styles.textCheck}>{check(checked)}</View>}
        </Button>
        {!unit.eligible && <Text style={layout.muted}>
          {unit.unavailableReason === "different-room" ? "This feedback can only be shared to its original Room." : "The source of this feedback is no longer available for sharing."}
        </Text>}
      </View>;
    })}
  </View>;
}

export function ProjectShare({ projectId, entry, onClose, initialRoom = "", requestKey, onShared, onShareError, preview = false }: {
  preview?: boolean;
  onShareError?: () => void;
  requestKey?: string; onShared?: (room: string) => void;
  initialRoom?: string; projectId: string; entry: ProjectEntry; onClose: () => void;
}) {
  const [room, setRoom] = useState(initialRoom);
  const [round, setRound] = useState("");
  const [statement, setStatement] = useState("");
  const [selection, setSelection] = useState<{ key: string; ids: string[] }>();
  const [reviewed, setReviewed] = useState<{ room: string; manifest: EntryShareManifest }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  const query = useProjectShare(projectId, entry.id, room, true);
  const publication = useRoomEntryPublication(projectId, entry.id, room, requestKey);
  const links = useContentLink();
  const rooms = query.memberships.data?.memberships.filter(item => !item.disabled) || [];
  const active = query.rounds.data?.activeRound;
  const canSubmit = active?.templateKey === "feedback" && active.viewerState?.canSubmit;
  const latestManifest = query.manifest.error ? undefined : query.manifest.data;
  const manifest = reviewed?.room === room ? reviewed.manifest : latestManifest;
  useEffect(() => {
    if (latestManifest && reviewed?.room !== room) setReviewed({ room, manifest: latestManifest });
  }, [latestManifest, reviewed?.room, room]);
  const sourceChanged = Boolean(latestManifest && manifest && latestManifest.revision !== manifest.revision);
  const previewUnavailable = Boolean(query.manifest.error);
  const selectionKey = `${room}:${manifest?.revision ?? ""}`;
  const selected = selection?.key === selectionKey ? selection.ids : manifest?.units.filter(unit => unit.eligible).map(unit => unit.id) ?? [];
  const hasSelection = Boolean(manifest && selected.some(id => manifest.units.some(unit => unit.id === id && unit.eligible)));
  const locked = busy || publication.prepared;
  const submit = async () => {
    if (flight.current || !room || !manifest || !hasSelection || (!publication.prepared && (sourceChanged || previewUnavailable))) return;
    flight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await publication.publish({ room_id: Number(room),
        ...(round && canSubmit ? { round_id: Number(round) } : {}),
        source_revision: manifest.revision, selected_unit_ids: selected, room_statement: statement.trim(),
      });
      if (onShared) onShared(room);
      else { await links.open(`/app/rooms/${room}`); onClose(); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn’t share this. Please try again.");
      onShareError?.();
    } finally { flight.current = false; setBusy(false); }
  };
  return <PopupMenu mode="page" open title={preview ? "Preview" : "Share with a Room"} actions={[]} width={560}
    onClose={onClose} dismissDisabled={busy}
    footer={<Button shape="pill" disabled={busy || !room || !hasSelection || (!publication.prepared && (sourceChanged || previewUnavailable))} onPress={() => { void submit(); }}>
      {busy ? "Sharing…" : publication.prepared ? "Retry sharing" : room ? `Share in ${query.room.data?.name || rooms.find(item => String(item.room.id) === room)?.room.name || "room"}` : "Share"}
    </Button>}>
    <View style={styles.form}>
      {!preview && <><Text style={layout.text}>Choose what to share. Tap a selected part to leave it out. Your project stays private.</Text>
      {query.memberships.isLoading && <ActivityIndicator accessibilityLabel="Loading your rooms" />}
      {query.memberships.error && <Button onPress={() => { void query.memberships.mutate().catch(() => {}); }}>Retry your rooms</Button>}
      {!query.memberships.isLoading && !query.memberships.error && !rooms.length && <Text style={layout.muted}>Join a Room to share your work.</Text>}
      <Select label="Room" value={room} disabled={locked || !rooms.length}
        options={[{ value: "", label: "Choose a Room" }, ...rooms.map(item => ({ value: String(item.room.id), label: item.room.name || "Room" }))]}
        renderOption={option => <View style={styles.roomOption}>
          {option.value && <RoomIcon name={option.label} avatarUrl={rooms.find(item => String(item.room.id) === option.value)?.room.avatar_url} size={24} />}
          <Text style={styles.roomName} numberOfLines={1}>{option.label}</Text>
        </View>}
        onValueChange={value => { setRoom(value); setRound(""); setError(undefined); }} />
      {(query.room.error || query.rounds.error) && <Button onPress={() => { void Promise.allSettled([query.room.mutate(), query.rounds.mutate()]); }}>Retry Room destinations</Button>}
      {canSubmit && active && <Select label="Destination" value={round}
        options={[{ value: "", label: "Room" }, { value: String(active.id), label: active.name }]}
        disabled={locked} onValueChange={setRound} />}
      </>}
      {room && query.manifest.isLoading && <ActivityIndicator accessibilityLabel="Loading share preview" />}
      {query.manifest.error && <View style={layout.section}>
        <Text accessibilityRole="alert" style={layout.text}>Could not load the share preview.</Text>
        <Button onPress={() => { void query.manifest.mutate().catch(() => {}); }}>Retry preview</Button>
      </View>}
      {sourceChanged && !publication.prepared && <View style={layout.section}>
        <Text accessibilityRole="alert" style={layout.text}>The original changed. Review the updated preview before sharing. New parts will be unselected.</Text>
        <Button disabled={busy} onPress={() => {
          if (!latestManifest) return;
          setSelection({ key: `${room}:${latestManifest.revision}`, ids: selected.filter(id => latestManifest.units.some(unit => unit.id === id && unit.eligible)) });
          setReviewed({ room, manifest: latestManifest });
          setError(undefined);
        }}>Review updated source</Button>
      </View>}
      {manifest && preview && <>
        <EntryContent interactive={false} entry={{ format: "mixed_media", format_data: { title: manifest.units.find(unit => unit.kind === "title" && selected.includes(unit.id))?.title }, content: { type: "doc", content: manifest.units.filter(unit => unit.eligible && selected.includes(unit.id) && unit.kind !== "title" && unit.kind !== "feedback").flatMap(unit => unit.content.content ?? []) } }} />
        {manifest.units.filter(unit => unit.kind === "feedback" && unit.eligible && selected.includes(unit.id)).map(unit => <View key={unit.id} style={layout.section}><Text style={layout.muted}>Feedback from {unit.authorName}</Text><EntryContent interactive={false} entry={{ format: "mixed_media", format_data: null, content: unit.content }} /></View>)}
      </>}
      {manifest && !preview && <ProjectShareSelection manifest={manifest} selected={selected} disabled={locked}
        toggle={id => setSelection({ key: selectionKey, ids: selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id] })} />}
      {!preview && <View style={layout.section}>
      <Text style={layout.text}>Anything you’d like to say to the room?</Text>
      <Input accessibilityLabel="Anything you’d like to say to the room?" value={statement} multiline maxLength={2000}
        editable={!locked} onChangeText={setStatement} />
      </View>}
      {manifest && !hasSelection && <Text style={layout.muted}>Select at least one part to share.</Text>}
      {(error || links.error) && <Text accessibilityRole="alert" style={layout.text}>{error || links.error}</Text>}
      {error && !publication.prepared && <Button emphasis="link" onPress={() => { void query.manifest.mutate().catch(() => {}); }}>Refresh source preview</Button>}
    </View>
  </PopupMenu>;
}
const styles = StyleSheet.create({
  form: { padding: 12, gap: 16 },
  units: { gap: 12 },
  unitGroup: { gap: 6 },
  unit: { alignItems: "stretch", borderWidth: 2, borderColor: tokens.border, borderRadius: 10, padding: 4, paddingRight: 32, gap: 8 },
  included: { borderColor: tokens.green },
  roomOption: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 },
  roomName: { fontFamily: "BarlowCondensedSemibold", fontSize: 18, color: tokens.ink, flexShrink: 1 },
  mediaSelection: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, borderWidth: 2, borderColor: "transparent", borderRadius: 4, alignItems: "flex-end", justifyContent: "flex-start", padding: 6 },
  textCheck: { position: "absolute", top: 6, right: 6 },
  preview: { width: "100%" },
  check: { width: 18, height: 18, borderWidth: 1, borderColor: tokens.ink, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  checked: { backgroundColor: tokens.green, borderColor: tokens.green },
});
