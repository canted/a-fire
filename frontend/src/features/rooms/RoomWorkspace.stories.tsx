import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { SWRConfig, unstable_serialize } from "swr";
import { RoomWorkspaceFrame } from "./RoomWorkspace";
import { SharedEntries } from "./RoomHome.stories";
import { Empty as EmptyComposer, FailedSend } from "./ChatComposer.stories";
import { useRoomWorkspace } from "../../hooks/useRoomWorkspace";
import { Button } from "../../components/Button";
import { ViewportToolbar } from "../../components/ViewportToolbar";
import type { RoomPayload, RoomMembersResponse, SideRoomsResponse } from "../../lib/api/rooms";
import { layout } from "../../styles/layout";

export default { title: "Expo/Rooms/Workspace", component: RoomWorkspaceFrame };
const roomDetails: RoomPayload = { id: 1, name: "Small hours studio", owner_id: 2, porosity: "closed", access: {
  kind: "member", can_manage: false, can_create_adjacent_room: false, can_view_notes: true, can_write_wall: true, can_participate_rounds: true,
} };
const members: RoomMembersResponse = { members: [{ id: 1, user_id: 1, display_username: "Alex" }, { id: 2, user_id: 2, display_username: "Maya" }] };
const sides: SideRoomsResponse = { parent: null, adjacent_rooms: [{ id: 2, name: "Quiet studies", porosity: "closed", porosity_label: "Knock only", member_count: 2, present_count: 0, viewer_state: "member", actions: { enter: true, join: false, request_join: false, knock: false, invite: false } }], can_create: false };
type State = "home" | "reading" | "details" | "shelf" | "failed";
function Fixture({ state = "reading", longName = false }: { state?: State; longName?: boolean }) {
  const [cache] = useState(() => new Map());
  const fallback = Object.fromEntries([
    [unstable_serialize(["room", "1", "member"]), roomDetails],
    [unstable_serialize(["room-members", "1", "member"]), members],
    [unstable_serialize(["room-adjacent-rooms", "1", "member"]), sides],
    [unstable_serialize(["room-introduction-pairs", "1", "member"]), { pairs: [] }],
    [unstable_serialize(["room-walls", "1", "member"]), { walls: [] }],
    ["memberships", { user: { id: 1, username: "Alex" }, memberships: [] }],
  ]);
  // Explicit cached data and paused revalidation keep previews out of the API.
  return <SWRConfig value={{ provider: () => cache, fallback, isPaused: () => true, revalidateOnMount: false, revalidateOnFocus: false }}>
    <Workspace state={state} longName={longName} />
  </SWRConfig>;
}
function Workspace({ state, longName }: { state: State; longName: boolean }) {
  const workspace = useRoomWorkspace({ room: "1", access: "member" });
  const [open, setOpen] = useState(state !== "home");
  const trigger = useRef<View>(null);
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (state === "details") workspace.toggleDetails();
    if (state === "shelf") workspace.openShelf();
  }, [state, workspace]);
  return <RoomWorkspaceFrame room="1" workspace={workspace} variant="chat" drawerOpen={open} closeChat={() => setOpen(false)} chatTrigger={trigger}
    title={longName ? "Small hours studio: unfinished landscapes and the sounds we return to" : roomDetails.name!}
    viewer={1} backLabel="Back to home" onBack={() => setOpen(false)} navigate={() => {}}
    home={<><SharedEntries />{!open && !workspace.detailsOpen && !workspace.shelfOpen && <ViewportToolbar><View style={layout.content}><Button ref={trigger} onPress={() => setOpen(true)}>Chat</Button></View></ViewportToolbar>}</>}>
    <View style={layout.content}><Button emphasis="link" accessibilityLabel="Close chat" onPress={() => setOpen(false)}>Close chat</Button></View>
    {state === "failed" ? <FailedSend /> : <EmptyComposer />}
  </RoomWorkspaceFrame>;
}
export const Home = () => <Fixture state="home" />;
export const Reading = () => <Fixture />;
export const DetailsOverChat = () => <Fixture state="details" />;
export const ShelfOverChat = () => <Fixture state="shelf" />;
export const FailedSendInDrawer = () => <Fixture state="failed" />;
export const LongRoomName = () => <Fixture longName />;
