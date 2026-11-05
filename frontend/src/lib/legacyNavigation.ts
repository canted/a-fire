import { Linking, Platform } from "react-native";
export function openLegacy(path: string) {
  const origin =
    process.env.EXPO_PUBLIC_LEGACY_WEB_URL ||
    (__DEV__
      ? `http://${Platform.OS === "android" ? "10.0.2.2" : "127.0.0.1"}:5173`
      : "");
  if (!origin)
    return Promise.reject(
      new Error("The original app link has not been configured."),
    );
  return Linking.openURL(new URL(path, origin).href);
}
