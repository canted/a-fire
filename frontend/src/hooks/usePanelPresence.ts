import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform } from "react-native";
import { ROOM_DETAILS_DURATION, ROOM_DETAILS_EASING } from "../lib/roomDetailsMotion";
import { useReducedMotion } from "./useReducedMotion";

/** Shared panel-only motion. Backdrops must be stationary siblings with opacity animation. */
export function usePanelPresence(open: boolean, height: number, direction: "top" | "bottom" = "bottom", duration = ROOM_DETAILS_DURATION) {
  const reduced = useReducedMotion();
  const [present, setPresent] = useState(open);
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (open) setPresent(true);
    let active = true;
    progress.stopAnimation(value => {
      if (!active || (!height && open && !reduced)) return;
      const target = open ? 1 : 0;
      Animated.timing(progress, { toValue: target, duration: reduced ? 0 : duration * Math.abs(target - value), easing: Easing.bezier(...ROOM_DETAILS_EASING), useNativeDriver: Platform.OS !== "web" }).start(({ finished }) => {
        if (active && finished && !open) setPresent(false);
      });
    });
    return () => { active = false; progress.stopAnimation(); };
  }, [open, reduced, progress, height, duration]);
  return { present, style: { opacity: height || reduced ? 1 : 0, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [direction === "bottom" ? height : -height, 0] }) }] } };
}
