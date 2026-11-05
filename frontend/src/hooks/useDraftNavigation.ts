import { useReloadBlocker } from "./useReloadBlocker";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";

/** Save before leaving an editor; pending media must be resolved explicitly. */
export function useDraftNavigation({
  dirty,
  busy,
  protect = false,
  busyMessage = "Finish or cancel the attachment or recording before leaving.",
  save,
  onError,
}: {
  dirty: boolean;
  protect?: boolean;
  busyMessage?: string;
  busy: boolean;
  save: () => Promise<void>;
  onError: (message: string) => void;
}) {
  useReloadBlocker(dirty || busy || protect);
  const navigation = useNavigation();
  const pending = useRef(false);
  const released = useRef(false);
  usePreventRemove(dirty || busy || protect, ({ data }) => {
    if (released.current) {
      released.current = false;
      navigation.dispatch(data.action);
      return;
    }
    if (busy) {
      onError(busyMessage);
      return;
    }
    if (pending.current) return;
    pending.current = true;
    void save()
      .then(() => navigation.dispatch(data.action))
      .catch((reason) => {
        onError(
          reason instanceof Error
            ? reason.message
            : "Could not save. Try again before leaving.",
        );
      })
      .finally(() => {
        pending.current = false;
      });
  });
  useEffect(() => {
    if (Platform.OS !== "web" || (!dirty && !busy)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  return {
    release: () => {
      released.current = true;
    },
  };
}
