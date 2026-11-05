import { useRoomOverlayDismiss } from "../../hooks/useRoomOverlayDismiss";
import { RoomWall } from "./RoomWall";
import { roundResultMembers } from "./wall/wallModel";
import { appRoutes } from "../../lib/appRoutes";
import { PageScrollView } from "../../components/PageScrollView";
import { Icon } from "../../components/Icon";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../../components/Button";
import { EntryFlow } from "../entries/EntryRepliesScreen";
import { useRoundResult } from "../../hooks/useRoundResult";
import { useRoomRounds } from "../../hooks/useRounds";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";
/** Round metadata, navigation and Entry flow around the shared RoomWall. */
export function RoundResultView({
  roomId,
  query,
  select,
  close,
  navigate,
  page = false,
}: {
  page?: boolean;
  roomId: string;
  query: ReturnType<typeof useRoundResult>;
  select: (id: string) => void;
  close: () => void;
  navigate: (path: string) => void;
}) {
  const rounds = useRoomRounds(roomId, !query.denied);
  const heading = useRef<Text>(null);
  const scroll = useRef<ScrollView>(null);
  const positions = useRef(new Map<string, number>());
  const restore = useRef(true);
  const [selection, setSelection] = useState<{
    wall: string;
    entry: string;
    entryId: string;
  }>();
  const wall =
    !query.denied && !query.detail.error && query.detail.data?.roomId === roomId
      ? query.detail.data
      : undefined;
  const entry =
    selection?.wall === wall?.id
      ? wall?.entries.find(
          (item) =>
            item.id === selection?.entry && item.available && item.entryId,
        )
      : undefined;
  const back = () => {
    restore.current = true;
    setSelection(undefined);
  };
  useRoomOverlayDismiss(Boolean(entry), back);
  useEffect(() => {
    restore.current = true;
    if (!wall || entry) return;
    const frame = requestAnimationFrame(() => {
      if (Platform.OS === "web") heading.current?.focus();
      else AccessibilityInfo.announceForAccessibility(wall.title);
    });
    return () => cancelAnimationFrame(frame);
  }, [wall?.id, entry?.id]);
  const rememberPosition = () => {
    // Browser focus/locator scrolling can precede the throttled onScroll event.
    const node =
      Platform.OS === "web"
        ? (scroll.current?.getScrollableNode() as
            | { scrollTop?: number }
            | undefined)
        : undefined;
    if (wall && typeof node?.scrollTop === "number")
      positions.current.set(wall.id, node.scrollTop);
  };
  const move = (id: string) => {
    rememberPosition();
    back();
    select(id);
  };
  const roomDetails = !rounds.room.error ? rounds.room.data : undefined;
  const current = !rounds.rounds.error
    ? (rounds.rounds.data?.currentRounds ??
      (rounds.rounds.data?.activeRound
        ? [rounds.rounds.data.activeRound]
        : []))
    : [];
  const manage = Boolean(
    roomDetails?.canManage || roomDetails?.access?.can_manage,
  );
  const knownTemplate =
    wall?.templateKey === "feedback" ||
    wall?.templateKey === "art_before_chorus";
  const list = query.walls.data?.walls ?? [];
  const index = list.findIndex((item) => item.id === wall?.id);
  const older = wall?.previousWallId === undefined ? (index >= 0 ? list[index + 1] : undefined) : wall.previousWallId ? { id: wall.previousWallId } : undefined;
  const newer = wall?.nextWallId === undefined ? (index > 0 ? list[index - 1] : undefined) : wall.nextWallId ? { id: wall.nextWallId } : undefined;
  const openEntry = (id: string, post: string) => {
    rememberPosition();
    setSelection({ wall: wall!.id, entry: id, entryId: post });
  };
  return (
    <View
      style={styles.root}
    >
      {entry && selection ? (
        <EntryFlow
          key={selection.entryId}
          id={selection.entryId}
          embedded
          onBack={back}
          onClose={close}
          onSelectPost={(post) => setSelection({ ...selection, entryId: post })}
        />
      ) : (
        <>
          <View style={[layout.content, styles.heading]}>
            <View style={page ? layout.appBar : layout.row}>
              {page && <Button emphasis="ghost" disabled={query.closing} accessibilityLabel="Back to room" onPress={close}><Icon name="caretLeft" size={24} /></Button>}
              <Text
                ref={heading}
                {...(Platform.OS === "web" ? { tabIndex: -1 } : {})}
                accessibilityRole="header"
                aria-level={Platform.OS === "web" ? 2 : undefined}
                style={[page ? layout.appBarTitle : layout.title, layout.grow, styles.headingTitle]}
              >
                {wall?.title || "Round history"}
              </Text>
              {!page && <Button
                emphasis="ghost"
                disabled={query.closing}
                accessibilityLabel="Close round history"
                onPress={close}
              >
                <Icon name="x" size={20} />
              </Button>}
            </View>
            {wall && (
              <>
                <Text style={styles.date}>
                  {new Date(wall.publishedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </Text>
                <Text style={layout.text}>
                  {wall.description || "Contributions from a completed round."}
                </Text>
              </>
            )}
          </View>
          <PageScrollView
            key={wall?.id ?? "loading"}
            ref={scroll}
            style={layout.grow}
            contentContainerStyle={[layout.section]}
            onScroll={(event) => {
              if (wall)
                positions.current.set(
                  wall.id,
                  event.nativeEvent.contentOffset.y,
                );
            }}
            scrollEventThrottle={100}
            onContentSizeChange={() => {
              if (wall && restore.current) {
                restore.current = false;
                scroll.current?.scrollTo({
                  y: positions.current.get(wall.id) ?? 0,
                  animated: false,
                });
              }
            }}
          >
            {query.denied && (
              <Text accessibilityRole="alert" style={layout.text}>
                This Room is no longer available.
              </Text>
            )}
            {(query.walls.isLoading || query.detail.isLoading) && (
              <ActivityIndicator accessibilityLabel="Loading collection" />
            )}
            {query.walls.error || query.detail.error ? (
              <>
                <Text accessibilityRole="alert" style={layout.text}>
                  This collection could not be loaded.
                </Text>
                <Button
                  onPress={() => {
                    void Promise.allSettled([
                      query.walls.mutate(),
                      query.detail.mutate(),
                    ]);
                  }}
                >
                  Retry collection
                </Button>
              </>
            ) : wall ? (
              <>
                <RoomWall members={roundResultMembers(wall)}
                  emptyMessage="This round completed without any contributions."
                  onOpenEntry={entry => {
                    const item = wall.entries.find(item => item.entryId === entry.id);
                    if (item) openEntry(item.id, entry.id);
                  }} />
                {manage &&
                rounds.rounds.data &&
                !rounds.rounds.error &&
                !current.length &&
                knownTemplate ? (
                  <Button
                    size="sm"
                    shape="pill"
                    emphasis="outline"
                    onPress={() =>
                      navigate(
                        appRoutes.roomRoundNew(roomId, wall.templateKey ?? undefined),
                      )
                    }
                  >
                    Start another round with this template
                  </Button>
                ) : current.length ? (
                  <Button
                    shape="pill"
                    onPress={() =>
                      navigate(
                        current.length === 1
                          ? appRoutes.round(current[0].id)
                          : `/app/rooms/${roomId}/rounds`,
                      )
                    }
                  >
                    {current.length === 1
                      ? "View ongoing round"
                      : "View ongoing rounds"}
                  </Button>
                ) : manage && !knownTemplate ? (
                  <Text style={layout.muted}>
                    This round’s template is no longer available. Another round
                    cannot be started from this Wall.
                  </Text>
                ) : manage && rounds.rounds.error ? (
                  <>
                    <Text accessibilityRole="alert" style={layout.text}>
                      Round availability could not be checked.
                    </Text>
                    <Button
                      emphasis="link"
                      onPress={() => {
                        void rounds.rounds.mutate().catch(() => {});
                      }}
                    >
                      Try again
                    </Button>
                  </>
                ) : null}
                <View style={layout.row}>
                  {older && (
                    <Button
                      size="sm"
                      emphasis="link"
                      onPress={() => move(older.id)}
                    >
                      Previous collection
                    </Button>
                  )}
                  {newer && (
                    <Button
                      size="sm"
                      emphasis="link"
                      style={styles.next}
                      onPress={() => move(newer.id)}
                    >
                      Next collection
                    </Button>
                  )}
                </View>
              </>
            ) : null}
            {!query.walls.isLoading && !query.walls.error && !list.length && (
              <Text style={layout.muted}>
                No completed rounds yet.
              </Text>
            )}
          </PageScrollView>
        </>
      )}
      {query.closeError && (
        <Text accessibilityRole="alert" style={[layout.content, layout.text]}>
          {query.closeError}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  headingTitle: { outlineWidth: 0 },
  root: { flex: 1, backgroundColor: tokens.paper },
  heading: { paddingVertical: 16, gap: 8 },
  date: { fontFamily: "Lato", fontSize: 12, color: tokens.muted },
  next: { marginLeft: "auto" },
});
