import { localAppLink } from "./contentLinks";
export const normalizeNavigationLink = (href: string) => localAppLink(href, window.location.origin);
/** Browser links always replace the current tab; internal app URLs use the router. */
export async function openOutsideRouter(href: string) {
  window.location.assign(href);
}
