import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import useSWRMutation from "swr/mutation";
import { fetchRoomWalls, fetchWall, presentWall } from "../lib/api/walls";
import { client } from "../lib/api";
export function useRoundResult(
  room: string,
  wall?: string,
  access?: "member" | "visitor" | "denied",
  latestWhenUnselected = false,
) {
  const walls = useSWR(
    !access || access === "denied" ? null : ["room-walls", room, access],
    () => fetchRoomWalls(client, room),
    { refreshInterval: 15000 },
  );
  const [arrival, setArrival] = useState<{ room: string; id: string }>();
  const latest = walls.data?.walls[0]?.id;
  useEffect(() => {
    if (latestWhenUnselected && latest) {
      setArrival(value => value?.room === room ? value : { room, id: latest });
    }
  }, [latestWhenUnselected, latest, room]);
  // Refreshes may prepend a new result; retain the collection being read until
  // the user explicitly chooses another one. Dismissal acknowledges that one.
  const selectedWall = wall ?? (latestWhenUnselected && arrival?.room === room ? arrival.id : undefined);
  const detail = useSWR(
    selectedWall && access && access !== "denied" ? ["wall", selectedWall, access] : null,
    () => fetchWall(client, selectedWall!),
    { refreshInterval: 15000 },
  );
  const shown = useSWRMutation(
    ["wall-presentation", room],
    (_key, { arg }: { arg: string }) => presentWall(client, arg),
  );
  const closing = useRef(false);
  const [closeError, setCloseError] = useState<string>();
  const dismiss = async (close: () => void) => {
    if (closing.current) return;
    closing.current = true;
    setCloseError(undefined);
    // Only acknowledge the authorized Wall actually displayed, never the list or a pending selection.
    const displayed =
      detail.data?.id === selectedWall && !detail.error ? selectedWall : undefined;
    try {
      if (displayed && access === "member") {
        await shown.trigger(displayed);
        await walls.mutate(
          (value) =>
            value
              ? {
                  walls: value.walls.map((item) =>
                    item.id === displayed ? { ...item, presented: true } : item,
                  ),
                }
              : value,
          { revalidate: false },
        );
      }
      close();
    } catch {
      setCloseError("Could not mark this collection as viewed. Reopen it to try again.");
      close();
    } finally {
      closing.current = false;
    }
  };
  return {
    denied: access === "denied",
    walls,
    detail,
    dismiss,
    closeError,
    closing: shown.isMutating,
  };
}
