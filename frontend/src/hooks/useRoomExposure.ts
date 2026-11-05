import { createContext, useCallback, useEffect, useMemo, useRef } from "react";
import { AppState, Platform, type View, type ViewToken } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  isMessageExposed,
  type ExposureRect,
} from "../lib/messageExposure";
import type { VirtualMessageGroup } from "../lib/messageGroups";
import type { RoomMessage } from "../lib/api/room";
import { useRoomReadReceipts } from "./useRoomReadReceipts";

type Row = { node: View; group: string; since?: number; reported?: boolean };
export const RoomExposure = createContext<
  (id: number, node: View | null, group: string) => void
>(() => {});
/** Per-message geometry, never group-level visibility: fetched rows aren't read. */
export function useRoomExposure(
  id: string,
  thread?: string,
  kind: "chat" | "post" | "post-replies" = "chat",
  active = true,
) {
  const visible = useRef(active);
  visible.current = active;
  const seen = useRoomReadReceipts(id, thread, kind);
  const rows = useRef(new Map<number, Row>());
  const viewport = useRef<View>(null);
  const focused = useRef(false);
  const candidates = useRef(new Set<string>());
  const viewabilityConfig = useRef({
    viewAreaCoveragePercentThreshold: 0,
  }).current;
  const onViewableItemsChanged = useRef(
    ({
      viewableItems,
    }: {
      viewableItems: ViewToken<VirtualMessageGroup<RoomMessage>>[];
    }) => {
      candidates.current = new Set(viewableItems.map((item) => item.item.key));
      rows.current.forEach((row) => {
        if (!candidates.current.has(row.group)) row.since = undefined;
      });
    },
  ).current;
  const generation = useRef(0);
  const foreground = () =>
    visible.current &&
    focused.current &&
    AppState.currentState === "active" &&
    (Platform.OS !== "web" ||
      (document.visibilityState === "visible" && document.hasFocus()));
  const reset = useCallback(() => {
    generation.current++;
    rows.current.forEach((row) => {
      row.since = undefined;
    });
  }, []);
  useEffect(() => { if (!active) reset(); }, [active, reset]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
        reset();
      };
    }, [reset]),
  );
  const measure = useCallback(() => {
    if (!foreground()) {
      reset();
      return;
    }
    const current = generation.current;
    viewport.current?.measureInWindow((x, y, width, height) => {
      const bounds: ExposureRect = { x, y, width, height };
      rows.current.forEach((row, message) => {
        if (row.reported || !candidates.current.has(row.group)) return;
        row.node.measureInWindow((rx, ry, rw, rh) => {
          if (
            current !== generation.current ||
            !foreground() ||
            rows.current.get(message) !== row
          )
            return;
          if (
            !isMessageExposed({ x: rx, y: ry, width: rw, height: rh }, bounds)
          ) {
            row.since = undefined;
            return;
          }
          row.since ??= Date.now();
          if (Date.now() - row.since >= 500) {
            row.reported = true;
            seen(message);
          }
        });
      });
    });
  }, [reset, seen]);
  useEffect(() => {
    const interval = setInterval(measure, 250);
    const state = AppState.addEventListener("change", reset);
    if (Platform.OS === "web") {
      window.addEventListener("blur", reset);
      document.addEventListener("visibilitychange", reset);
    }
    return () => {
      clearInterval(interval);
      state.remove();
      reset();
      if (Platform.OS === "web") {
        window.removeEventListener("blur", reset);
        document.removeEventListener("visibilitychange", reset);
      }
    };
  }, [measure, reset]);
  const register = useCallback(
    (message: number, node: View | null, group: string) => {
      if (node) rows.current.set(message, { node, group });
      else rows.current.delete(message);
    },
    [],
  );
  return useMemo(
    () => ({
      viewport,
      rows,
      register,
      measure,
      viewabilityConfig,
      onViewableItemsChanged,
    }),
    [register, measure, viewabilityConfig, onViewableItemsChanged],
  );
}
