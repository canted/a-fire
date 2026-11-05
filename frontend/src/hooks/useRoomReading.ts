import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import type { RoomMessage } from "../lib/api/room";
import type { VirtualMessageGroup } from "../lib/messageGroups";
import type { useRoomExposure } from "./useRoomExposure";
import type { useRoom, useRoomDraft } from "./useRooms";
import {
  readingAnchorAtBoundary,
  readingAnchorTop,
  readingAnchorCorrection,
} from "../lib/messageExposure";

type Group = VirtualMessageGroup<RoomMessage>;
export function useRoomReading({
  room,
  draft,
  groups,
  list,
  exposure,
  target,
  consumeTarget,
  active = true,
}: {
  active?: boolean;
  room: ReturnType<typeof useRoom>;
  draft: ReturnType<typeof useRoomDraft>;
  groups: Group[];
  list: RefObject<FlatList<Group> | null>;
  exposure: ReturnType<typeof useRoomExposure>;
  target: string | null;
  consumeTarget: () => void;
}) {
  return useMessageReading({
    active,
    source: {
      ready: Boolean(room.live.data),
      error: room.live.error || room.history.error,
      validating: room.live.isValidating || room.history.isValidating,
      messages: room.messages,
      hasMore: room.hasOlder,
      loadMore: room.loadOlder,
      refresh: () => room.live.mutate(),
      bounded: true,
    },
    draft,
    groups,
    list,
    exposure,
    target,
    consumeTarget,
    inverted: true,
    followInitially: true,
    noun: "message",
  });
}

type ReadingSource = {
  ready: boolean;
  error: unknown;
  validating: boolean;
  messages: Array<{ id: number }>;
  hasMore: boolean;
  loadMore: () => Promise<unknown>;
  refresh: () => Promise<unknown>;
  bounded?: boolean;
};
/** Shared target reveal, measured anchoring and pagination for Chat and entry replies. */
export function useMessageReading({
  source,
  draft,
  groups,
  list,
  exposure,
  target,
  consumeTarget,
  inverted,
  followInitially,
  noun,
  active = true,
}: {
  active?: boolean;
  source: ReadingSource;
  draft: ReturnType<typeof useRoomDraft>;
  groups: Group[];
  list: RefObject<FlatList<Group> | null>;
  exposure: ReturnType<typeof useRoomExposure>;
  target: string | null;
  consumeTarget: () => void;
  inverted: boolean;
  followInitially: boolean;
  noun: "message" | "reply";
}) {
  const current = useRef({ source, draft, groups, exposure, consumeTarget, active });
  current.current = { source, draft, groups, exposure, consumeTarget, active };
  const offset = useRef(0);
  const viewportHeight = useRef(0);
  const contentHeight = useRef(0);
  const following = useRef(followInitially);
  const initialized = useRef(false);
  const userScrolling = useRef(false);
  const seeking = useRef<{
    id: number;
    top?: number;
    attempts: number;
    stable?: number;
    refreshing?: boolean;
  } | null>(null);
  const previousNewest = useRef<number | undefined>(undefined);
  const historyCursor = useRef<number | undefined>(undefined);
  const [away, setAway] = useState(false);
  const [newMessages, setNewMessages] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const captureTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scroll = useCallback(
    (next: number) => {
      if (!current.current.active) return;
      offset.current = Math.max(0, next);
      list.current?.scrollToOffset({ offset: offset.current, animated: false });
    },
    [list],
  );
  const capture = useCallback(() => {
    if (!current.current.active || seeking.current || !initialized.current) return;
    const snapshot = offset.current;
    const { exposure: geometry, draft: stored } = current.current;
    stored.update(
      {
        offset: snapshot,
        distanceFromStart: Math.max(
          0,
          contentHeight.current - viewportHeight.current - snapshot,
        ),
      },
      false,
    );
    if (following.current) {
      stored.update({ anchor: undefined }, false);
      return;
    }
    geometry.viewport.current?.measureInWindow((_, top, __, height) => {
      let best: { id: number; top: number } | undefined;
      let remaining = geometry.rows.current.size;
      geometry.rows.current.forEach((row, id) =>
        row.node.measureInWindow((_x, y, _w, h) => {
          if (y + h > top && y < top + height && (!best || y - top < best.top))
            best = { id, top: y - top };
          if (
            --remaining === 0 &&
            snapshot === offset.current &&
            !seeking.current &&
            best
          )
            stored.update({ anchor: best }, false);
        }),
      );
    });
  }, []);
  const latest = useCallback(() => {
    seeking.current = null;
    initialized.current = true;
    following.current = true;
    userScrolling.current = false;
    setAway(false);
    setNewMessages(false);
    setNotice(null);
    const next = inverted
      ? 0
      : Math.max(0, contentHeight.current - viewportHeight.current);
    current.current.draft.update({ offset: next, anchor: undefined }, false);
    if (target) current.current.consumeTarget();
    scroll(next);
  }, [scroll, target, inverted]);
  useEffect(() => {
    if (!target) return;
    const goal = { id: Number(target), attempts: 0, refreshing: true };
    seeking.current = goal;
    initialized.current = true;
    following.current = false;
    setAway(true);
    setNotice(`Finding ${noun}…`);
    // A warm link can arrive while the cached snapshot still describes visitor
    // access. Resolve current access before declaring its target unavailable.
    void current.current.source
      .refresh()
      .catch(() => {})
      .finally(() => {
        goal.refreshing = false;
      });
  }, [target, noun]);
  useEffect(() => {
    if (!active || !source.ready || initialized.current) return;
    if (process.env.EXPO_PUBLIC_ROOM_BENCHMARK === "1")
      console.warn(
        "[Room reading]",
        JSON.stringify({
          event: "restore",
          offset: draft.offset,
          anchor: draft.anchor?.id,
          newest: current.current.source.messages.at(-1)?.id,
        }),
      );
    initialized.current = true;
    following.current = followInitially && draft.offset <= 1;
    setAway(!following.current);
    if (!following.current && draft.anchor)
      seeking.current = { ...draft.anchor, attempts: 0 };
    else scroll(draft.offset);
  }, [active, source.ready, draft.offset, draft.anchor, scroll, followInitially]);
  useEffect(() => {
    const newest = source.messages.at(-1)?.id;
    if (
      previousNewest.current &&
      newest &&
      newest > previousNewest.current &&
      !following.current
    )
      setNewMessages(true);
    previousNewest.current = newest;
    if (following.current && initialized.current)
      requestAnimationFrame(() =>
        scroll(
          inverted
            ? 0
            : Math.max(0, contentHeight.current - viewportHeight.current),
        ),
      );
  }, [source.messages, scroll, inverted]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!current.current.active) return;
      const goal = seeking.current;
      if (!goal || goal.refreshing) return;
      const state = current.current;
      if (!state.source.ready) {
        if (state.source.error)
          setNotice(`Could not find the ${noun}. Retry loading history.`);
        return;
      }
      const index = state.groups.findIndex((group) =>
        group.ids.includes(String(goal.id)),
      );
      if (index < 0) {
        if (state.source.error) {
          setNotice(`Could not find the ${noun}. Retry loading history.`);
          return;
        }
        if (state.source.validating) return;
        const oldest = state.source.messages[0]?.id;
        const newest = state.source.messages.at(-1)?.id;
        if (
          state.source.bounded &&
          oldest !== undefined &&
          newest !== undefined &&
          (goal.id > newest || goal.id >= oldest)
        ) {
          seeking.current = null;
          setNotice(
            noun === "message"
              ? "This message is unavailable in your Room history."
              : "This reply is unavailable in your entry history.",
          );
          state.consumeTarget();
          return;
        }
        if (state.source.hasMore) {
          if (!state.source.validating)
            void state.source.loadMore().catch(() => {});
        } else {
          seeking.current = null;
          setNotice(
            noun === "message"
              ? "This message is unavailable in your Room history."
              : "This reply is unavailable in your entry history.",
          );
          state.consumeTarget();
        }
        return;
      }
      if (++goal.attempts > 100) {
        seeking.current = null;
        setNotice(
          `Could not position this ${noun}. Open the link to try again.`,
        );
        return;
      }
      const node = state.exposure.rows.current.get(goal.id)?.node;
      if (
        process.env.EXPO_PUBLIC_ROOM_BENCHMARK === "1" &&
        goal.attempts % 10 === 1
      )
        console.warn(
          "[Room reading]",
          JSON.stringify({
            event: "seek",
            id: goal.id,
            index,
            attempt: goal.attempts,
            mounted: Boolean(node),
            offset: offset.current,
          }),
        );
      if (!node) {
        list.current?.scrollToIndex({
          index,
          animated: false,
          viewPosition: 0.5,
        });
        return;
      }
      state.exposure.viewport.current?.measureInWindow(
        (_x, top, _w, height) => {
          node.measureInWindow((_rx, y, _rw, rowHeight) => {
            if (seeking.current !== goal || height <= 0 || rowHeight <= 0)
              return;
            const desired = readingAnchorTop(goal.top, height, rowHeight);
            const difference = readingAnchorCorrection(
              desired,
              y - top,
              inverted,
            );
            if (
              process.env.EXPO_PUBLIC_ROOM_BENCHMARK === "1" &&
              goal.attempts % 10 === 1
            )
              console.warn(
                "[Room reading]",
                JSON.stringify({
                  event: "seek-geometry",
                  id: goal.id,
                  y,
                  top,
                  height,
                  rowHeight,
                  desired,
                  difference,
                }),
              );
            const atBoundary = readingAnchorAtBoundary(
              offset.current,
              difference,
              Math.max(0, contentHeight.current - height),
              y - top,
              rowHeight,
              height,
            );
            if (!atBoundary && Math.abs(difference) > 2 && goal.attempts < 95) {
              goal.stable = 0;
              scroll(offset.current + difference);
              return;
            }
            goal.stable = (goal.stable ?? 0) + 1;
            if (goal.stable < 4) return;
            seeking.current = null;
            setNotice(null);
            state.draft.update(
              { anchor: { id: goal.id, top: y - top }, offset: offset.current },
              false,
            );
            state.consumeTarget();
          });
        },
      );
    }, 100);
    return () => {
      clearInterval(timer);
      clearTimeout(captureTimer.current);
    };
  }, [list, scroll, inverted, noun]);
  const beginReading = () => {
    if (process.env.EXPO_PUBLIC_ROOM_BENCHMARK === "1")
      console.warn(
        "[Room reading]",
        JSON.stringify({
          event: "drag",
          offset: offset.current,
          newest: current.current.source.messages.at(-1)?.id,
        }),
      );
    seeking.current = null;
    following.current = false;
    initialized.current = true;
    userScrolling.current = true;
    if (target) {
      current.current.consumeTarget();
      setNotice(null);
    }
  };
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!active) return;
    offset.current = Math.max(0, event.nativeEvent.contentOffset.y);
    if (!initialized.current || seeking.current) return;
    if (!userScrolling.current) return;
    following.current = inverted
      ? offset.current <= 1
      : contentHeight.current - viewportHeight.current - offset.current <= 1;
    setAway(!following.current);
    if (following.current) setNewMessages(false);
    current.current.draft.update({ offset: offset.current }, false);
    clearTimeout(captureTimer.current);
    captureTimer.current = setTimeout(() => {
      capture();
      userScrolling.current = false;
    }, 150);
    const remaining =
      event.nativeEvent.contentSize.height -
      event.nativeEvent.layoutMeasurement.height -
      offset.current;
    const oldest = inverted
      ? source.messages[0]?.id
      : source.messages.at(-1)?.id;
    if (
      remaining <= 80 &&
      source.hasMore &&
      !source.validating &&
      !source.error &&
      historyCursor.current !== oldest
    ) {
      historyCursor.current = oldest;
      void source.loadMore().catch(() => {});
    }
    exposure.measure();
  };
  return {
    away,
    newMessages,
    notice,
    dismissNotice: () => setNotice(null),
    latest,
    beginReading,
    onScroll,
    onLayout(height: number) {
      if (!active || !height) return;
      viewportHeight.current = height;
      if (following.current)
        scroll(
          inverted
            ? 0
            : Math.max(0, contentHeight.current - viewportHeight.current),
        );
      else if (!seeking.current && current.current.draft.anchor)
        seeking.current = { ...current.current.draft.anchor, attempts: 0 };
    },
    onContentSizeChange(height: number) {
      if (!active || !height) return;
      const changed = contentHeight.current !== height;
      contentHeight.current = height;
      if (following.current)
        scroll(
          inverted
            ? 0
            : Math.max(0, contentHeight.current - viewportHeight.current),
        );
      else if (
        changed &&
        !seeking.current &&
        !userScrolling.current &&
        current.current.draft.anchor
      ) {
        seeking.current = { ...current.current.draft.anchor, attempts: 0 };
      }
    },
    onScrollToIndexFailed(info: { averageItemLength: number; index: number }) {
      scroll(info.averageItemLength * info.index);
    },
  };
}
