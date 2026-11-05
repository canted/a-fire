import { Toast } from "../../components/Toast";
import { RoomLoading } from "./RoomLoading";
import { RoomHeader } from "./RoomHeader";
import { useRoomIdentityPreview } from "../../hooks/useRoomIdentityPreview";
import { useChatDraft } from "../../hooks/useChatDraft";
import { useRoomVisit } from "../../hooks/useRoomVisit";
import { ProjectSharePicker } from "../projects/ProjectSharePicker";
import { RoomHome, RoomRoundContext } from "./RoomHome";
import { useRoomHome } from "../../hooks/useRoomHome";
import { useViewportGeometry } from "../../hooks/useViewportGeometry";
import { RoomWorkspaceFrame } from "./RoomWorkspace";
import { useRoomWorkspace } from "../../hooks/useRoomWorkspace";
import { ViewportToolbar } from "../../components/ViewportToolbar";
import { useChatSaveFeedback } from "../../hooks/useChatActions";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { RoomExposure, useRoomExposure } from "../../hooks/useRoomExposure";
import { useRoomReading } from "../../hooks/useRoomReading";
import { useRoomBenchmark } from "../../hooks/useRoomBenchmark";
import { roomMessageTarget } from "../../lib/roomLinks";
import { useEffect, useMemo, useRef, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ViewportShell } from "../../components/ViewportShell";
import { Icon } from "../../components/Icon";
import { MessageGroup } from "./MessageGroup";
import {
  virtualMessageGroups,
  type VirtualMessageGroup,
} from "../../lib/messageGroups";
import { ApiError } from "../../lib/api/transport";
import type { RoomMessage } from "../../lib/api/room";
import { Button } from "../../components/Button";
import { ChatComposer } from "./ChatComposer";
import { useChatComposition } from "../../hooks/useChatComposition";
import { useRoom, useRooms } from "../../hooks/useRooms";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";

export type RoomRouteParams = { "#"?: string; message?: string; wall?: string; panel?: string };
export function RoomScreen({ chatOpen = true, covered = false, routeParams, roomId: activeRoomId }: { chatOpen?: boolean; covered?: boolean; routeParams?: RoomRouteParams; roomId?: string }) {
  const localParams = useLocalSearchParams<{ roomId: string }>();
  const roomId = activeRoomId ?? localParams.roomId;
  const visit = useRoomVisit(roomId, !covered);
  const preview = useRoomIdentityPreview(roomId);
  const navigation = useRoomNavigation();
  if (!visit.ready) return <ViewportShell>
    <View {...(Platform.OS === "web" ? { dataSet: { roomNavigationReady: `/app/rooms/${roomId}${chatOpen ? "/chat" : ""}` } } : {})} style={layout.grow}>
      <RoomHeader title={preview.name} avatar={preview.avatar} loading
        detailsOpen={false} shelfOpen={false} hasSides={false} detailsRef={null} shelfRef={null}
        onBack={navigation.home} backLabel="Back to Home" onDetails={() => {}} onShelf={() => {}} />
      {visit.error ? <View style={[layout.content, layout.section]}>
        <Text accessibilityRole="header" style={layout.title}>Room unavailable</Text>
        <Text accessibilityRole="alert" style={layout.text}>This visit is unavailable. You may need to knock again.</Text>
        <Button emphasis="outline" onPress={visit.retry}>Check access again</Button>
      </View> : <RoomLoading />}
    </View>
  </ViewportShell>;
  // Chat owns horizontal message gestures. Native interactive-pop competes
  // with swipe-to-save (including the system-wide iOS back gesture).
  // Keep the explicit ancestry-aware back action and normal push transitions.
  return (
    <>
      <Stack.Screen
        options={{ gestureEnabled: false, fullScreenGestureEnabled: false }}
      />
      <RoomFlow key={roomId} id={roomId} chatOpen={chatOpen} covered={covered} routeParams={routeParams} />
    </>
  );
}
export function RoomFlow({ id, chatOpen, covered, routeParams }: { id: string; chatOpen: boolean; covered: boolean; routeParams?: RoomRouteParams }) {
  const router = useRouter();
  const [sharing, setSharing] = useState(false);
  const navigation = useRoomNavigation();
  const localParams = useLocalSearchParams<RoomRouteParams>();
  const params = routeParams ?? localParams;
  const target = roomMessageTarget(params["#"], params.message);
  const room = useRoom(id);
  const preview = useRoomIdentityPreview(id);
  const saveFeedback = useChatSaveFeedback(id);
  useRoomBenchmark(id, room.messages.length);
  const rooms = useRooms();
  const denied =
    room.live.error instanceof ApiError &&
    [401, 403, 404].includes(room.live.error.status);
  const requestedWall =
    params.wall && /^[1-9]\d*$/.test(params.wall) ? params.wall : undefined;
  const workspace = useRoomWorkspace({
    room: id,
    access: denied ? "denied" : room.live.data?.viewer_access?.kind,
    requestedWall,
    requestedDetails: params.panel === "details",
    presentOnArrival: false,
    onWallChange: (wall) => router.setParams({ wall }),
  });
  const { details, detailsOpen, wallOpen, shelfOpen } = workspace;
  const chatVisible = chatOpen && !covered && !detailsOpen && !wallOpen && !shelfOpen;
  const exposure = useRoomExposure(id, undefined, "chat", chatVisible);
  const home = useRoomHome(id, !denied);
  const geometry = useViewportGeometry();
  const chatTrigger = useRef<View>(null);
  const openedHere = useRef(false);
  const previouslyOpen = useRef(chatOpen);
  const restoreChatFocus = useRef(false);
  useEffect(() => {
    if (previouslyOpen.current && !chatOpen) {
      restoreChatFocus.current = true;
      const frame = requestAnimationFrame(() => {
        if (chatTrigger.current) {
          chatTrigger.current.focus();
          restoreChatFocus.current = false;
        }
      });
      previouslyOpen.current = chatOpen;
      return () => cancelAnimationFrame(frame);
    }
    previouslyOpen.current = chatOpen;
  }, [chatOpen]);
  const closeChat = () => {
    if (openedHere.current && router.canGoBack()) router.back();
    else router.replace(`/app/rooms/${id}`);
    openedHere.current = false;
  };
  useEffect(() => {
    if (params.panel !== "side") return;
    workspace.openShelf();
    router.setParams({ panel: undefined });
  }, [params.panel, router, workspace.openShelf]);
  const groups = useMemo(
    () =>
      virtualMessageGroups(
        room.messages,
        (message) => String(message.id),
        (message) =>
          message.round_event
            ? undefined
            : (message.author?.id ?? message.masked_author?.display_username),
      ).reverse(),
    [room.messages],
  );
  const draft = useChatDraft(id, room.live.data?.viewer_user_id);
  const list = useRef<FlatList<VirtualMessageGroup<RoomMessage>>>(null);
  const reading = useRoomReading({
    room,
    draft,
    groups,
    list,
    exposure,
    target,
    active: chatVisible,
    consumeTarget: () => router.setParams({ "#": "", message: undefined }),
  });
  const title =
    details.room.data?.name ||
    rooms.data?.rooms.find((item) => String(item.id) === id)?.name ||
    preview.name;
  const canSend = !denied && room.live.data?.viewer_access?.can_send === true;
  const composition = useChatComposition(
    id,
    draft,
    room,
    reading.latest,
    canSend,
  );
  if (denied)
    return (
      <ViewportShell>
        <View style={[layout.content, layout.section]}>
          <Button emphasis="link" onPress={() => navigation.home()}>
            Back to Home
          </Button>
          <Text accessibilityRole="header" style={layout.title}>
            Room unavailable
          </Text>
          <Text accessibilityRole="alert" style={layout.text}>
            This Room is unavailable or you no longer have access to it.
          </Text>
          <Button
            emphasis="outline"
            onPress={() => {
              void room.live.mutate().catch(() => {});
            }}
          >
            Check access again
          </Button>
        </View>
      </ViewportShell>
    );
  return (
    <RoomExposure.Provider value={exposure.register}>
      <RoomWorkspaceFrame
        navigationReadyPath={`/app/rooms/${id}${chatOpen ? "/chat" : ""}`}
        variant="chat"
        drawerOpen={chatOpen}
        chatToolbar={
            <View style={styles.dock}>
              {!denied && reading.away && (
                <Button
                  dataSet={{ audioClearance: "latest" }}
                  accessibilityLabel={
                    reading.newMessages
                      ? "New messages. Scroll to bottom"
                      : "Scroll to bottom"
                  }
                  emphasis="ghost"
                  style={styles.latest}
                  onPress={reading.latest}
                >
                  <View style={styles.latestIcon}>
                    <Icon name="arrowDown" size={22} />
                  </View>
                </Button>
              )}
              {canSend ? (
                <ChatComposer
                  title={title}
                  draft={draft}
                  composition={composition}
                />
              ) : (
                !denied &&
                room.live.data && (
                  <Text style={layout.muted}>
                    You can read this Room, but posting is unavailable.
                  </Text>
                )
              )}
            </View>
        }
        closeChat={closeChat}
        chatTrigger={chatTrigger}
        home={<>
          {Boolean(workspace.walls.closeError) && <Text accessibilityRole="alert" style={[layout.content, layout.muted]}>{workspace.walls.closeError}</Text>}
          <RoomHome query={home} historyRef={chatOpen ? undefined : workspace.wallRef}
            openEntry={(entry, reply) => navigation.destination(`/app/entries/${entry.id}${reply ? `?reply=${encodeURIComponent(reply)}` : ""}`)}
            openHistory={workspace.openWall} />
          {sharing && <ProjectSharePicker room={id} roomName={title} onClose={() => setSharing(false)} create={() => { setSharing(false); navigation.destination(`/app/rooms/${id}/new-entry`); }} />}
          {!chatOpen && !detailsOpen && !shelfOpen && !wallOpen && <ViewportToolbar>
            <View style={[layout.content, styles.homeDock]}>
              <Button ref={node => { chatTrigger.current = node; if (node && restoreChatFocus.current) { node.focus(); restoreChatFocus.current = false; } }} emphasis="outline" onPress={() => { openedHere.current = true; router.push(`/app/rooms/${id}/chat`); }}>Chat</Button>
              {home.roomData?.access?.can_write_wall && home.home.data && !home.home.error && <Button style={layout.entryFab} color={tokens.projectEntryAction} shape="pill" accessibilityLabel="Add entry" onPress={() => setSharing(true)}><Icon name="plusBold" color={tokens.paper} size={24} /></Button>}
            </View>
          </ViewportToolbar>}
        </>}
        room={id}
        workspace={workspace}
        title={title}
        avatar={details.room.data?.avatar_url ?? preview.avatar}
        viewer={room.live.data?.viewer_user_id}
        backLabel={
          details.room.data?.parent
            ? "Step out to parent Room"
            : "Back to home"
        }
        onBack={() =>
          details.room.data?.parent
            ? navigation.parent(String(details.room.data.parent.id))
            : navigation.home()
        }
        navigate={navigation.destination}
      >
        <View pointerEvents="box-none" style={styles.drawerHeading}>
          <Text pointerEvents="none" accessibilityRole="header" style={styles.chatLabel}>Chat</Text>
          <Button ref={chatOpen ? workspace.wallRef : undefined} emphasis="ghost" style={styles.closeChat} accessibilityLabel="Close chat" onPress={closeChat}><Icon name="x" size={22} /></Button>
        </View>
        {!geometry.keyboardOpen && <View style={layout.content}><RoomRoundContext query={home} compact /></View>}
        <Toast message={saveFeedback.data || reading.notice} onDismiss={() => { if (saveFeedback.data) void saveFeedback.mutate(null, { revalidate: false }); else reading.dismissNotice(); }} />
        {room.connection !== "live" && (
          <Text accessibilityLiveRegion="polite" style={styles.connection}>
            {room.connection === "offline"
              ? "Offline — reconnecting…"
              : room.connection === "reconnecting"
                ? "Reconnecting…"
                : "Syncing messages…"}
          </Text>
        )}
        {room.live.isLoading && (
          <ActivityIndicator accessibilityLabel="Loading messages" />
        )}
        <View ref={exposure.viewport} collapsable={false} style={layout.grow}>
          {room.live.error && (!room.live.data || denied) ? (
            <View style={[layout.content, layout.section]}>
              <Text accessibilityRole="alert" style={layout.text}>
                {room.live.error.message}
              </Text>
              <Button
                onPress={() => {
                  void room.live.mutate().catch(() => {});
                }}
              >
                Try again
              </Button>
            </View>
          ) : (
            <FlatList
              accessibilityLabel={`${title} chat messages`}
              ref={list}
              style={layout.grow}
              contentContainerStyle={[layout.content, styles.timeline, !groups.length && styles.emptyTimeline]}
              inverted
              data={groups}
              keyExtractor={(item) => item.key}
              initialNumToRender={3}
              maxToRenderPerBatch={3}
              windowSize={3}
              removeClippedSubviews={false}
              viewabilityConfig={exposure.viewabilityConfig}
              onViewableItemsChanged={exposure.onViewableItemsChanged}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              onScrollBeginDrag={reading.beginReading}
              {...(Platform.OS === "web"
                ? { onWheel: reading.beginReading }
                : {})}
              onLayout={(event) =>
                reading.onLayout(event.nativeEvent.layout.height)
              }
              onScroll={reading.onScroll}
              scrollEventThrottle={100}
              onContentSizeChange={(_, height) =>
                reading.onContentSizeChange(height)
              }
              onScrollToIndexFailed={reading.onScrollToIndexFailed}
              renderItem={({ item, index }) => (
                <MessageGroup surface="surface" room={id} group={item} last={index === 0} canSaveMessage={!denied && room.live.data?.viewer_access?.kind === "member"} />
              )}
              ListEmptyComponent={
                !room.live.isLoading ? (
                  <Text style={[layout.muted, styles.emptyMessage]}>No messages yet.</Text>
                ) : null
              }
              ListFooterComponent={
                (room.hasOlder || room.history.error) ? <View style={layout.section}>
                  {room.history.error && (
                    <Text accessibilityRole="alert" style={layout.text}>
                      Could not load earlier messages.
                    </Text>
                  )}
                  {(room.hasOlder || room.history.error) && (
                    <Button
                      emphasis="link"
                      disabled={room.history.isValidating}
                      onPress={() => {
                        void (
                          room.history.error
                            ? room.history.mutate()
                            : room.loadOlder()
                        ).catch(() => {});
                      }}
                    >
                      {room.history.isValidating
                        ? "Loading…"
                        : room.history.error
                          ? "Retry loading history"
                          : "Load earlier messages"}
                    </Button>
                  )}
                </View> : null
              }
            />
          )}
        </View>

      </RoomWorkspaceFrame>
    </RoomExposure.Provider>
  );
}

const styles = StyleSheet.create({
  homeDock: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 10, paddingBottom: 0, backgroundColor: tokens.surface },
  drawerHeading: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 3, alignItems: "center", justifyContent: "center", height: 52, backgroundColor: "transparent" },
  chatLabel: { fontFamily: "Lato", fontSize: 14, color: "rgb(200, 200, 200)" },
  closeChat: { position: "absolute", top: 4, right: 4, width: 44, height: 44, minHeight: 44, padding: 0, borderRadius: 22 },
  saveFeedback: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: tokens.paper,
  },
  latest: {
    position: "absolute",
    bottom: "100%",
    marginBottom: 10,
    left: "50%",
    transform: [{ translateX: -22 }],
    zIndex: 2,
    width: 44,
    height: 44,
    minHeight: 44,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  latestIcon: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: tokens.borderStrong,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: tokens.paper,
  },
  connection: {
    fontFamily: "Lato",
    fontSize: 12,
    color: tokens.muted,
    textAlign: "center",
  },
  emptyTimeline: { flexGrow: 1, justifyContent: "center", paddingTop: 0, paddingBottom: 0 },
  emptyMessage: { textAlign: "center" },
  timeline: {
    paddingTop: tokens.viewportContentClearance + 20.8,
    paddingBottom: 52,
  },
  dock: {
    backgroundColor: tokens.surface,
    borderTopWidth: 1,
    borderTopColor: tokens.border,
    paddingTop: 8,
    paddingBottom: 0,
  },
});
