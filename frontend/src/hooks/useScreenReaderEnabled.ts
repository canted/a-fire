import { useSyncExternalStore } from "react";
import { AccessibilityInfo, Platform } from "react-native";

// One platform listener for all mounted message rows, including virtualized ones.
let enabled = false;
const listeners = new Set<() => void>();
let subscription:
  | ReturnType<typeof AccessibilityInfo.addEventListener>
  | undefined;
function update(value: boolean) {
  if (enabled === value) return;
  enabled = value;
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  // Web cannot detect assistive technology; the message surface supports keyboard action reveal there.
  if (Platform.OS === "web") return () => {};
  listeners.add(listener);
  if (!subscription) {
    subscription = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      update,
    );
    const active = subscription;
    void AccessibilityInfo.isScreenReaderEnabled().then((value) => {
      if (subscription === active) update(value);
    });
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      subscription?.remove();
      subscription = undefined;
    }
  };
}
export function useScreenReaderEnabled() {
  return useSyncExternalStore(
    subscribe,
    () => enabled,
    () => false,
  );
}
