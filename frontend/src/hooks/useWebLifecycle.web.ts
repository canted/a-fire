import { useEffect } from "react";
import { registerPrivateMediaCache } from "../lib/privateMediaCache";
import { registerNotificationNavigation } from "../lib/notificationNavigation";
/** Reuse the browser worker and notification activation owners; no native side effects. */
export function useWebLifecycle() {
  useEffect(() => {
    const stop = registerNotificationNavigation((target) =>
      window.location.replace(target),
    );
    if (!__DEV__) void registerPrivateMediaCache();
    return stop;
  }, []);
}
