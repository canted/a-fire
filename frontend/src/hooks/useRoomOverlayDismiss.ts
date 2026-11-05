import { useEffect, useRef } from "react";
import { BackHandler } from "react-native";
export function useRoomOverlayDismiss(open: boolean, close: () => void) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        latest.current();
        return true;
      },
    );
    return () => subscription.remove();
  }, [open]);
}
