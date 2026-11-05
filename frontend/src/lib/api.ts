import { Platform } from "react-native";
import { SessionTransport } from "./api/transport";
import { sessionStorage } from "./sessionStorage";

// Android emulator localhost refers to Android, not the workstation.
export const apiBaseUrl =
  process.env.EXPO_PUBLIC_API_URL ||
  (__DEV__
    ? `http://${Platform.OS === "android" ? "10.0.2.2" : "localhost"}:4000/api`
    : "");
if (!apiBaseUrl)
  throw new Error("Set EXPO_PUBLIC_API_URL before building the preview.");
if (!__DEV__ && !apiBaseUrl.startsWith("https://"))
  throw new Error("The deployed API must use HTTPS.");
let changed = (_reset: boolean) => {};
export const client = new SessionTransport(
  apiBaseUrl,
  sessionStorage,
  (_, reset) => changed(reset),
);
export function onSessionChange(callback: (reset: boolean) => void) {
  changed = callback;
  const stop = client.observeExternalSession();
  return () => {
    stop();
    if (changed === callback) changed = () => {};
  };
}
