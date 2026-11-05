import { Platform, Share } from "react-native";
import { apiBaseUrl } from "./api";

/** Browser clipboard and native share sheet adapt the same canonical app URL. */
export async function shareAppLink(path: string) {
  const url = new URL(path, new URL(apiBaseUrl).origin).href;
  if (Platform.OS === "web") {
    await navigator.clipboard.writeText(url);
    return "Link copied.";
  }
  const result = await Share.share({ message: url, url });
  return result.action === Share.dismissedAction ? undefined : "Link shared.";
}
