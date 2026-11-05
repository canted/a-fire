import { Linking } from "react-native";
import { openLegacy } from "./legacyNavigation";
export const normalizeNavigationLink = (href: string) => href;
export async function openOutsideRouter(href: string) {
  if (href.startsWith("/")) await openLegacy(href);
  else await Linking.openURL(href);
}
