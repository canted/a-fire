import { useRoomOverlayDismiss } from "./useRoomOverlayDismiss";
import { usePanelPresence } from "./usePanelPresence";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { LayoutChangeEvent } from "react-native";
import { ROOM_DETAILS_DURATION, ROOM_SHELF_DURATION } from "../lib/roomDetailsMotion";

export function useRoomDetailsPresence(open: boolean, close: () => void, focus: RefObject<{ focus(): void } | null>, compact = false, direction: "top" | "bottom" = "top") {
  const [height, setHeight] = useState(0);
  const motion = usePanelPresence(open, height, direction, compact ? ROOM_SHELF_DURATION : ROOM_DETAILS_DURATION);
  const wasOpen = useRef(open);
  useRoomOverlayDismiss(open, close);
  useEffect(() => {
    if (!open && wasOpen.current) focus.current?.focus();
    wasOpen.current = open;
  }, [open, focus]);
  return { ...motion, onLayout: (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height) };
}
