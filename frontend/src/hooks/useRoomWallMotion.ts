import type { RefObject } from "react";
import { useRoomDetailsPresence } from "./useRoomDetailsPresence";
export function useRoomWallMotion(
  open: boolean,
  close: () => void,
  focus: RefObject<{ focus(): void } | null>,
) {
  const presence = useRoomDetailsPresence(open, close, focus);
  return {
    ...presence,
    transition: (_direction: "opening" | "closing", update: () => void) =>
      update(),
  };
}
