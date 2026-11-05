import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import useSWRMutation from "swr/mutation";
import { client } from "../lib/api";
import { observeRoomVisitActivity } from "../lib/roomVisitActivity";

export function useRoomVisit(room: string, active = true) {
  const [admitted, setAdmitted] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const flight = useRef<Promise<unknown> | null>(null);
  const mutation = useSWRMutation(["room-visit", room], () => client.post<{ kind: "member" | "visitor"; expires_at: string | null }>(`/v2/rooms/${room}/visit`, {}));
  const { trigger } = mutation;
  const enter = useCallback(() => {
    if (flight.current) return;
    flight.current = trigger().then(result => { setAdmitted(room); setExpiresAt(result.expires_at); setExpired(false); }, () => setAdmitted(null)).finally(() => { flight.current = null; });
  }, [room, trigger]);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => { setAdmitted(null); setExpired(true); }, Math.max(0, Date.parse(expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);
  useFocusEffect(useCallback(() => {
    if (!active) return;
    return observeRoomVisitActivity(enter);
  }, [active, enter]));
  return { ready: admitted === room, error: mutation.error || expired, retry: enter };
}
