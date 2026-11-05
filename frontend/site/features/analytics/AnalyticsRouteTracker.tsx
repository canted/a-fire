import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { captureEvent } from "../../lib/analytics";
import { resolveAnalyticsRoute } from "../../lib/analyticsRoutes";

export function AnalyticsRouteTracker() {
  const location = useLocation();
  const previousKey = useRef<string | null>(null);

  useEffect(() => {
    const key = `${location.pathname}?${location.search}`;
    if (previousKey.current === key) return;
    previousKey.current = key;
    captureEvent("screen_viewed", resolveAnalyticsRoute(location.pathname, location.search));
  }, [location.pathname, location.search]);

  return null;
}
