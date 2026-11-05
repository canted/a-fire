import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { useSWRConfig } from "swr";
import {
  subscribeToRoom,
  type RoomConnectionStatus,
} from "../lib/roomSubscription";
import { cable } from "../lib/cable";

export function useRoomSubscription(
  id: string,
  revalidateHistory: () => Promise<unknown>,
  revalidateDetail?: () => Promise<unknown>,
) {
  const { mutate } = useSWRConfig();
  const detailRefresh = useRef(revalidateDetail);
  detailRefresh.current = revalidateDetail;
  const historyRefresh = useRef(revalidateHistory);
  historyRefresh.current = revalidateHistory;
  const [status, setStatus] = useState<RoomConnectionStatus>("connecting");
  useEffect(() => {
    if (!id) return;
    const online = () => Platform.OS !== "web" || navigator.onLine;
    // Infinite queries own an aggregate cache entry; mutating individual page
    // keys does not notify that entry. Use the mounted query's bound mutation.
    const refreshHistory = () => {
      void historyRefresh.current().catch(() => {});
    };
    const subscription = subscribeToRoom({
      id,
      consumer: cable.getCableConsumer(),
      status: setStatus,
      online,
      refresh: () => Promise.all([
        mutate(key => Array.isArray(key) && key[0] === "home"),
        mutate(["room", id]),
        mutate(["room-home", id]),
        mutate(key => Array.isArray(key) && key[0] === "room-rounds" && String(key[1]) === id),
        detailRefresh.current?.(),
      ]),
      refreshHistory,
      changed: event => {
        if (event.type === "presence") return;
        void mutate(key => Array.isArray(key) && ["board", "room-home", "room-rounds", "board-activities", "room-walls"].includes(String(key[0]))).catch(() => {});
      },
    });
    const resume = () => {
      if (!online()) {
        subscription.disconnected();
        return;
      }
      if (AppState.currentState && AppState.currentState !== "active") return;
      if (Platform.OS === "web" && document.visibilityState !== "visible")
        return;
      cable.ensureCableConnected();
      cable.refreshChatPresence(id);
      void subscription.refresh();
      refreshHistory();
    };
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") resume();
    });
    if (Platform.OS === "web") {
      window.addEventListener("online", resume);
      window.addEventListener("offline", subscription.offline);
      window.addEventListener("pageshow", resume);
      window.addEventListener("focus", resume);
      document.addEventListener("visibilitychange", resume);
    }
    // Presence and recovery safety net; message delivery is socket-driven.
    const heartbeat = setInterval(resume, 30_000);
    return () => {
      clearInterval(heartbeat);
      appState.remove();
      subscription.unsubscribe();
      if (Platform.OS === "web") {
        window.removeEventListener("online", resume);
        window.removeEventListener("offline", subscription.offline);
        window.removeEventListener("pageshow", resume);
        window.removeEventListener("focus", resume);
        document.removeEventListener("visibilitychange", resume);
      }
    };
  }, [id, mutate]);
  return status;
}
