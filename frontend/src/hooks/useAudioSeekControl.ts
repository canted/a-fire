import { useRef } from "react";
import type { View, GestureResponderEvent } from "react-native";
import { formatAudioTimestamp } from "../lib/audioTimestamp";

/** Shared pointer, keyboard and assistive seek contract for compact and full players. */
export function useAudioSeekControl({
  position,
  duration,
  seek,
  title = "audio",
}: {
  position: number;
  duration: number;
  seek: (seconds: number) => void;
  title?: string;
}) {
  const ref = useRef<View>(null);
  return {
    ref,
    accessibilityRole: "adjustable" as const,
    accessibilityLabel: `Seek ${title}`,
    accessibilityValue: {
      min: 0,
      max: duration,
      now: Math.min(position, duration),
      text: `${formatAudioTimestamp(position)} of ${formatAudioTimestamp(duration)}`,
    },
    accessibilityActions: [
      { name: "increment", label: "Forward five seconds" },
      { name: "decrement", label: "Back five seconds" },
    ],
    onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) =>
      seek(position + (event.nativeEvent.actionName === "increment" ? 5 : -5)),
    onKeyDown: (event: {
      nativeEvent: { key: string };
      preventDefault: () => void;
    }) => {
      const key = event.nativeEvent.key;
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) {
        event.preventDefault();
        seek(
          key === "Home"
            ? 0
            : key === "End"
              ? duration
              : position + (key === "ArrowLeft" ? -5 : 5),
        );
      }
    },
    onPress: (event: GestureResponderEvent) => {
      const x = event.nativeEvent.pageX;
      if (Number.isFinite(x))
        ref.current?.measureInWindow((left, _top, width) => {
          if (width > 0) seek(((x - left) / width) * duration);
        });
    },
  };
}
