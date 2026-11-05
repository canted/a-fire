import { useEffect, useRef } from "react";
import { Platform } from "react-native";

// Explicit local production-build profiling only; no message contents or credentials.
const enabled = process.env.EXPO_PUBLIC_ROOM_BENCHMARK === "1";
let navigation: { id: string; at: number } | undefined;
export function markRoomNavigation(id: string) {
  if (enabled) navigation = { id, at: performance.now() };
}
export function useRoomBenchmark(id: string, loadedMessages: number) {
  const start = useRef(
    navigation?.id === id ? navigation.at : performance.now(),
  );
  const mountedAt = useRef(performance.now());
  const recorded = useRef(false);
  useEffect(() => {
    if (!enabled || !loadedMessages || recorded.current) return;
    recorded.current = true;
    const dataEffectAt = performance.now();
    let frame = 0;
    let settledTimer: ReturnType<typeof setTimeout> | undefined;
    let phase: "navigation" | "settled" = "navigation";
    let previous = performance.now();
    const gaps: number[] = [];
    const measure = (now: number) => {
      gaps.push(now - previous);
      previous = now;
      if (gaps.length === 2 && phase === "navigation") {
        const memory = (
          performance as Performance & { memory?: { usedJSHeapSize: number } }
        ).memory;
        // eslint-disable-next-line no-console -- Opt-in local profiling output, never production telemetry.
        console.info(
          "[Room benchmark]",
          JSON.stringify({
            event: "rows-ready",
            platform: Platform.OS,
            room: id,
            navigationToRowsMs: Math.round(now - start.current),
            loadedMessages,
            navigationToMountMs: Math.round(mountedAt.current - start.current),
            navigationToDataEffectMs: Math.round(dataEffectAt - start.current),
            ...(Platform.OS === "web"
              ? {
                  mountedMessages:
                    document.querySelectorAll('[id^="chat-"]').length,
                }
              : {}),
            ...(memory
              ? { approximateJsHeapBytes: memory.usedJSHeapSize }
              : {}),
          }),
        );
      }
      if (gaps.length < 120) {
        frame = requestAnimationFrame(measure);
        return;
      }
      const sorted = gaps.slice(2).sort((a, b) => a - b);
      // eslint-disable-next-line no-console -- Opt-in local profiling output, never production telemetry.
      console.info(
        "[Room benchmark]",
        JSON.stringify({
          event: "js-frame-cadence",
          phase,
          platform: Platform.OS,
          room: id,
          samples: sorted.length,
          p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
          maxMs: Math.round(sorted.at(-1)! * 10) / 10,
        }),
      );
      if (phase === "navigation")
        settledTimer = setTimeout(() => {
          phase = "settled";
          gaps.length = 0;
          previous = performance.now();
          frame = requestAnimationFrame(measure);
        }, 10_000);
    };
    frame = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settledTimer);
    };
  }, [id, loadedMessages]);
}
