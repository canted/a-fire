import { drawerStyles } from "../../components/drawerStyles";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useViewportGeometry } from "../../hooks/useViewportGeometry";
import { useRoomDetailsPresence } from "../../hooks/useRoomDetailsPresence";
import { Animated, Platform, StyleSheet, View } from "react-native";
import type { RoomPayload } from "../../lib/api/rooms";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { ViewportToolbar } from "../../components/ViewportToolbar";
import { ViewportShell } from "../../components/ViewportShell";
import { useRoomWorkspace } from "../../hooks/useRoomWorkspace";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { RoomHeader } from "./RoomHeader";
import { RoomDetails } from "./RoomDetails";
import { RoundResultView } from "./RoundResultView";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";

type WorkspaceProps = {
  roomId: string;
  room?: RoomPayload;
  denied?: boolean;
  children: ReactNode;
  backToChat?: boolean;
  backDestination?: string;
  backLabel?: string;
};

/** Destination adapter; Chat supplies its live access and arrival policy separately. */
export function RoomWorkspace({
  roomId: room,
  room: roomDetails,
  denied,
  children,
  backToChat = false,
  backDestination,
  backLabel,
}: WorkspaceProps) {
  const navigation = useRoomNavigation();
  const workspace = useRoomWorkspace({
    room,
    access: denied ? "denied" : roomDetails?.access?.kind,
  });
  function back() {
    if (backDestination) navigation.ancestor(backDestination);
    else if (backToChat) navigation.ancestor(`/app/rooms/${room}/chat`);
    else navigation.ancestor(`/app/rooms/${room}`);
  }
  return (
    <RoomWorkspaceFrame
      room={room}
      workspace={workspace}
      title={roomDetails?.name || "Room"}
      avatar={roomDetails?.avatar_url}
      viewer={workspace.details.identity.data?.user.id}
      backToChat={backToChat}
      backLabel={
        backLabel ??
        (backToChat
          ? "Back to room chat"
          : "Back to Room")
      }
      onBack={back}
      navigate={navigation.destination}
    >
      {children}
    </RoomWorkspaceFrame>
  );
}

type FrameProps = {
  room: string;
  workspace: ReturnType<typeof useRoomWorkspace>;
  title: string;
  avatar?: string | null;
  viewer?: number;
  backToChat?: boolean;
  backLabel: string;
  onBack: () => void;
  navigate: (href: string) => void;
  children: ReactNode;
  variant?: "chat" | "workspace";
  home?: ReactNode;
  drawerOpen?: boolean;
  closeChat?: () => void;
  chatTrigger?: RefObject<View | null>;
  chatToolbar?: ReactNode;
  navigationReadyPath?: string;
};

/** One Room header, surface, toolbar and overlay presentation owner. */
export function RoomWorkspaceFrame({
  room,
  workspace: state,
  title,
  avatar,
  viewer,
  backToChat,
  backLabel,
  onBack,
  navigate,
  children,
  variant = "workspace",
  home,
  drawerOpen = true,
  closeChat = () => {},
  chatTrigger,
  chatToolbar,
  navigationReadyPath,
}: FrameProps) {
  const chat = variant === "chat";
  const geometry = useViewportGeometry();
  const expanded = chat && drawerOpen && geometry.keyboardOpen && !state.detailsOpen;
  const [headerHeight, setHeaderHeight] = useState(64);
  const fallbackTrigger = useRef<View>(null);
  const drawer = useRoomDetailsPresence(chat && drawerOpen, () => {
    if (state.detailsOpen) state.closeDetails();
    else if (state.shelfOpen) state.closeShelf();
    else if (state.wallOpen) state.closeWall();
    else closeChat();
  }, chatTrigger ?? fallbackTrigger, false, "bottom");
  const {
    detailsOpen,
    shelfOpen,
    wallOpen,
    details,
    walls,
    presence,
    shelf,
    wallMotion,
  } = state;
  const detailsPanel = presence.present && (
    <View pointerEvents="box-none" style={[styles.detailsClip, { top: headerHeight }]}>
    <Animated.View
      onLayout={presence.onLayout}
      pointerEvents={detailsOpen ? "auto" : "none"}
      accessibilityElementsHidden={!detailsOpen}
      importantForAccessibility={detailsOpen ? "auto" : "no-hide-descendants"}
      style={[styles.details, presence.style]}
    >
      <RoomDetails
        viewer={viewer}
        details={details}
        close={state.closeDetails}
      />
    </Animated.View>
    </View>
  );
  const wallPanel = wallMotion.present && (
    <Animated.View
      onLayout={wallMotion.onLayout}
      style={[
        StyleSheet.absoluteFill,
        chat ? styles.chatWall : styles.wall,
        wallMotion.style,
      ]}
      {...(Platform.OS === "web"
        ? {
            ...(chat
              ? {
                  dataSet: { wallSnapshot: "panel" },
                  "aria-label": walls.detail.data?.title || "Wall",
                }
              : {}),
          }
        : {})}
      {...(chat
        ? {
            accessibilityElementsHidden: !wallOpen,
            importantForAccessibility: wallOpen
              ? ("auto" as const)
              : ("no-hide-descendants" as const),
            pointerEvents: wallOpen ? ("auto" as const) : ("none" as const),
          }
        : {})}
    >
      <RoundResultView
        roomId={room}
        query={walls}
        close={state.closeWall}
        select={state.selectWall}
        navigate={(href) => state.leaveWall(() => navigate(href))}
      />
    </Animated.View>
  );
  return (
    <View
      style={layout.grow}
      {...(Platform.OS === "web" ? { dataSet: { roomNavigationReady: navigationReadyPath } } : {})}
      accessibilityViewIsModal={wallOpen}
      {...(Platform.OS === "web" && wallOpen ? {
        role: "dialog" as const,
        "aria-modal": true,
        "aria-label": walls.detail.data?.title || "Round history",
      } : {})}
    >
    <ViewportShell
      suppressToolbar={detailsOpen || shelfOpen}
      floatingAudioPlayer={chat ? true : undefined}
      surface={wallOpen || detailsOpen ? tokens.paper : tokens.surface}
    >
      <View
        style={layout.grow}
        {...(chat
          ? {
              onTouchStart: state.interact,
              ...(Platform.OS === "web" ? { onKeyDown: state.interact } : {}),
            }
          : {})}
      >
        <View onLayout={event => { if (event.nativeEvent.layout.height) setHeaderHeight(event.nativeEvent.layout.height); }}>
        <RoomHeader
          title={title}
          avatar={avatar}
          detailsOpen={detailsOpen}
          shelfOpen={shelfOpen}
          hasSides={Boolean(details.sides.data?.adjacent_rooms.length)}
          detailsRef={state.detailsRef}
          shelfRef={state.shelfRef}
          hidden={wallOpen || expanded}
          backToChat={backToChat}
          backLabel={backLabel}
          onBack={onBack}
          onDetails={state.toggleDetails}
          onShelf={state.toggleShelf}
        />
        </View>
        <View style={layout.grow}>
          {chat && <View style={[StyleSheet.absoluteFill, (drawerOpen || detailsOpen || shelfOpen || wallOpen) && styles.hidden]}>{home}</View>}
          <Animated.View
            onLayout={chat ? drawer.onLayout : undefined}
            pointerEvents={(!chat || drawerOpen) && !detailsOpen && !shelfOpen && !wallOpen ? "auto" : "none"}
            accessibilityElementsHidden={(chat && !drawerOpen) || detailsOpen || shelfOpen || wallOpen}
            importantForAccessibility={(chat && !drawerOpen) || detailsOpen || shelfOpen || wallOpen ? "no-hide-descendants" : "auto"}
            style={[
              layout.grow,
              chat && StyleSheet.absoluteFill,
              chat && styles.drawer,
              chat && drawer.style,
              ((chat && !drawer.present) || detailsOpen || shelfOpen || wallOpen) && styles.hidden,
            ]}
          >
            {children}
          </Animated.View>
        </View>
        {!chat &&
          !detailsOpen &&
          !wallOpen &&
          Boolean(walls.walls.data?.walls.length) &&
          wallControl()}
        {chat ? wallPanel : detailsPanel}
        {shelfOpen && (
          <Button
            emphasis="ghost"
            accessibilityLabel="Dismiss Side Rooms shelf"
            style={[StyleSheet.absoluteFill, styles.shelfBackdrop]}
            onPress={state.closeShelf}
          >
            {chat ? <View /> : null}
          </Button>
        )}
        {shelf.present && (
          <Animated.View
            onLayout={shelf.onLayout}
            pointerEvents={shelfOpen ? "auto" : "none"}
            accessibilityElementsHidden={!shelfOpen}
            importantForAccessibility={
              shelfOpen ? "auto" : "no-hide-descendants"
            }
            style={[styles.shelf, { top: expanded ? 0 : headerHeight }, shelf.style]}
          >
            <RoomDetails
              compact
              viewer={viewer}
              details={details}
              close={state.closeShelf}
              expand={state.expandShelf}
            />
          </Animated.View>
        )}
        {chat ? detailsPanel : wallPanel}
      </View>
      {chat && drawer.present && !detailsOpen && !shelfOpen && !wallOpen && chatToolbar && (
        <ViewportToolbar>
          <Animated.View style={drawer.style} pointerEvents={drawerOpen ? "auto" : "none"}
            accessibilityElementsHidden={!drawerOpen}
            importantForAccessibility={drawerOpen ? "auto" : "no-hide-descendants"}>
            {chatToolbar}
          </Animated.View>
        </ViewportToolbar>
      )}
    </ViewportShell>
    </View>
  );

  function wallControl() {
    return (
      <View
        style={[
          layout.content,
          styles.wallControl,
          chat && styles.chatWallControl,
        ]}
        pointerEvents="box-none"
      >
        <Button
          ref={state.wallRef}
          dataSet={{ wallControl: "fab" }}
          emphasis="ghost"
          style={[styles.wallButton, chat && styles.chatWallButton]}
          accessibilityLabel="Open round collection"
          onPress={state.openWall}
        >
          <Icon name="squaresFourFill" size={28} />
        </Button>
      </View>
    );
  }
}
const styles = StyleSheet.create({
  hidden: { display: "none" },
  drawer: { ...drawerStyles.panel, borderTopWidth: 1, borderTopColor: tokens.paper },
  detailsClip: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    overflow: "hidden", zIndex: 6,
  },
  details: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: tokens.paper,
    zIndex: 6,
  },
  shelfBackdrop: { zIndex: 2 },
  shelf: {
    position: "absolute",
    top: 64,
    right: 12,
    width: 320,
    maxWidth: "94%",
    maxHeight: "80%",
    backgroundColor: tokens.paper,
    borderRadius: tokens.radius,
    boxShadow: "0 8px 24px rgba(31,26,26,0.18)",
    zIndex: 3,
  },
  wallControl: {
    position: "absolute",
    top: 64,
    zIndex: 1,
    alignItems: "flex-end",
  },
  chatWallControl: { top: 70, zIndex: 2 },
  wallButton: {
    width: 44,
    height: 44,
    padding: 0,
    backgroundColor: tokens.paper,
    borderRadius: 22,
  },
  chatWallButton: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    boxShadow: "0 3px 12px rgba(26,37,39,0.12)",
  },
  wall: { backgroundColor: tokens.paper, zIndex: 4 },
  chatWall: { backgroundColor: tokens.paper },
});
