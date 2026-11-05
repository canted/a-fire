import { useRef, useState, type RefObject } from "react";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { PopupMenu } from "../../components/PopupMenu";
import { useEntryQuery } from "../../hooks/useEntryQuery";
import { useEntryWithdrawal } from "../../hooks/useEntryWithdrawal";
import { StyleSheet, Text, View } from "react-native";
import { UserIdentity } from "../../components/UserIdentity";
import { layout } from "../../styles/layout";
import { WallMember } from "./wall/WallMember";
import type { WallMemberModel } from "./wall/wallModel";
import type { WallProcessEntry } from "./wall/selectWallProcess";

/** Shared Wall presentation. Views own data, selection, scrolling and navigation. */
export function RoomWall({ members, emptyMessage, onOpenEntry, onOpenFeedback }: {
  members: WallMemberModel[];
  emptyMessage: string;
  onOpenEntry: (entry: WallProcessEntry) => void;
  onOpenFeedback?: (entry: WallProcessEntry, reply: string) => void;
}) {
  const [selected, setSelected] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const fallbackAnchor = useRef<View>(null);
  const [anchor, setAnchor] = useState<RefObject<View | null>>(fallbackAnchor);
  const entry = useEntryQuery(selected);
  const navigation = useRoomNavigation();
  const post = !entry.error ? entry.data?.entry : undefined;
  const sourcePath = post?.source_entry_id && post.keep_project_id ? `/app/projects/${post.keep_project_id}/entries/${post.source_entry_id}` : undefined;
  const withdrawal = useEntryWithdrawal(entry.error ? undefined : entry.data?.entry);
  const close = () => { setSelected(undefined); setConfirm(false); };
  const actions = [
    ...(sourcePath ? [{ id: "source", label: "View source", onSelect: () => { close(); navigation.destination(sourcePath); } }] : []),
    ...(withdrawal.available ? [{ id: "remove", label: "Remove", onSelect: () => setConfirm(true) }] : []),
  ];
  const empty = members.length === 0;
  return <View style={styles.root}>
    {empty && <Text style={layout.muted}>{emptyMessage}</Text>}
    {Array.from({ length: Math.ceil(members.length / 2) }, (_, row) => <View key={members[row * 2].id} style={styles.row}>
      {members.slice(row * 2, row * 2 + 2).map(member => <View key={member.id} style={styles.member}>
        {member.available ? <WallMember artist={member.name} avatarUrl={member.avatarUrl} slots={member.slots}
          onOpenEntry={onOpenEntry} onOpenFeedback={onOpenFeedback}
          onActions={(item, target) => { setAnchor(target); setSelected(item.id); }} /> : <>
          <UserIdentity username={member.name} avatarUrl={member.avatarUrl} />
          <Text style={layout.muted}>Shared work no longer available.</Text>
        </>}
      </View>)}
      {row * 2 + 1 === members.length && <View style={styles.member} />}
    </View>)}
    <PopupMenu mode="menu" anchor={anchor} open={Boolean(selected) && !confirm} title="Options" onClose={close}
      actions={actions.length ? actions : [{
        id: "status", label: entry.error ? "Could not load actions" : entry.isLoading ? "Loading…" : "No actions available", disabled: true, onSelect: () => {},
      }]} />
    <PopupMenu mode="dialog" open={confirm} title="Remove from room?" dismissDisabled={withdrawal.busy} onClose={close} actions={[
      { id: "cancel", label: "Keep in room", disabled: withdrawal.busy, onSelect: close },
      { id: "remove", label: withdrawal.busy ? "Removing…" : "Remove", disabled: withdrawal.busy, onSelect: () => { void withdrawal.withdraw().then(removed => { if (removed) close(); }); } },
    ]}>
      <Text style={layout.text}>This item and its replies will no longer be available in the room. Your private original is unchanged.</Text>
      {withdrawal.error && <Text accessibilityRole="alert" style={layout.text}>{withdrawal.error}</Text>}
    </PopupMenu>
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 24 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  member: { flex: 1, minWidth: 0, gap: 10 },
});
