import { useRoomNavigation } from "./useRoomNavigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { View } from "react-native";
import { useRoomDetails } from "./useRoomDetails";
import { useRoomDetailsPresence } from "./useRoomDetailsPresence";
import { useRoundResult } from "./useRoundResult";
import { useRoomWallMotion } from "./useRoomWallMotion";

type Options = {
  room: string;
  access?: "member" | "visitor" | "denied";
  requestedWall?: string;
  requestedDetails?: boolean;
  presentOnArrival?: boolean;
  onWallChange?: (wall: string | undefined) => void;
};

/** Room overlay coordination shared by Chat, Notes, Rounds and Settings. */
export function useRoomWorkspace({
  room,
  access,
  requestedWall,
  requestedDetails = false,
  presentOnArrival = false,
  onWallChange,
}: Options) {
  const navigation = useRoomNavigation();
  const [detailsOpen, setDetailsOpen] = useState(requestedDetails);
  useEffect(() => { if (requestedDetails) setDetailsOpen(true); }, [requestedDetails]);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [wallOpen, setWallOpen] = useState(Boolean(requestedWall));
  const [wallId, setWallId] = useState(requestedWall);
  const details = useRoomDetails(room, detailsOpen || shelfOpen, access);
  const walls = useRoundResult(room, wallOpen ? wallId : undefined, access);
  const detailsRef = useRef<View>(null);
  const shelfRef = useRef<View>(null);
  const wallRef = useRef<View>(null);
  const arrival = useRef({ checked: false, interacted: false });
  const previousRequestedWall = useRef(requestedWall);
  const dismissWall = useRef(walls.dismiss);
  dismissWall.current = walls.dismiss;

  useEffect(() => {
    const previous = previousRequestedWall.current;
    previousRequestedWall.current = requestedWall;
    if (requestedWall) {
      setWallId(requestedWall);
      setWallOpen(true);
    } else if (previous) void dismissWall.current(() => setWallOpen(false));
  }, [requestedWall]);
  useEffect(() => {
    if (
      !presentOnArrival ||
      arrival.current.checked ||
      walls.walls.isLoading ||
      (!walls.walls.data && !walls.walls.error)
    )
      return;
    arrival.current.checked = true;
    const latest = walls.walls.data?.walls[0];
    if (
      !requestedWall &&
      latest &&
      !latest.presented &&
      !arrival.current.interacted
    ) {
      setWallId(latest.id);
      setWallOpen(true);
    }
  }, [
    presentOnArrival,
    walls.walls.data,
    walls.walls.isLoading,
    walls.walls.error,
    requestedWall,
  ]);

  const closeWall = () => {
    void walls.dismiss(() =>
      wallMotion.transition("closing", () => {
        setWallOpen(false);
        if (requestedWall) onWallChange?.(undefined);
      }),
    );
  };
  const wallMotion = useRoomWallMotion(wallOpen, closeWall, wallRef);
  const presence = useRoomDetailsPresence(
    detailsOpen,
    () => setDetailsOpen(false),
    detailsRef,
  );
  const shelf = useRoomDetailsPresence(
    shelfOpen,
    () => setShelfOpen(false),
    shelfRef,
    true,
  );
  const interact = () => {
    arrival.current.interacted = true;
  };
  const openShelf = useCallback(() => {
    setDetailsOpen(false);
    setShelfOpen(true);
  }, []);
  return {
    details,
    walls,
    detailsOpen,
    shelfOpen,
    wallOpen,
    detailsRef,
    shelfRef,
    wallRef,
    presence,
    shelf,
    wallMotion,
    interact,
    toggleDetails: () => {
      interact();
      setShelfOpen(false);
      setDetailsOpen((value) => !value);
    },
    toggleShelf: () => {
      interact();
      setDetailsOpen(false);
      setShelfOpen((value) => !value);
    },
    openShelf,
    closeDetails: () => setDetailsOpen(false),
    closeShelf: () => setShelfOpen(false),
    expandShelf: () => {
      setShelfOpen(false);
      setDetailsOpen(true);
    },
    openWall: () => {
      interact();
      setDetailsOpen(false);
      setShelfOpen(false);
      navigation.destination(`/app/rooms/${room}/round-history`);
    },
    closeWall,
    selectWall: (id: string) => {
      setWallId(id);
      onWallChange?.(id);
    },
    leaveWall: (navigate: () => void) => {
      void walls.dismiss(() => {
        setWallOpen(false);
        onWallChange?.(undefined);
        navigate();
      });
    },
  };
}
