import type { AnalyticsProperties, AnalyticsRouteName, AnalyticsSurface } from "./analytics";

type RouteDefinition = {
  path: string;
  routeName: AnalyticsRouteName;
  surface: AnalyticsSurface;
};

const ROUTES: RouteDefinition[] = [
  { path: "/", routeName: "site_home", surface: "site" },
  { path: "/auth", routeName: "auth_request_otp", surface: "site" },
  { path: "/auth/verify", routeName: "auth_verify_otp", surface: "site" },
  { path: "/auth/invite/:token", routeName: "auth_accept_invite", surface: "site" },
  { path: "/app", routeName: "app_home_redirect", surface: "app" },
  { path: "/app/profile", routeName: "profile", surface: "app" },
  { path: "/app/notification-preferences", routeName: "notification_preferences", surface: "app" },
  { path: "/app/notices", routeName: "notices", surface: "app" },
  { path: "/app/new-entry", routeName: "post_composer", surface: "app" },
  { path: "/app/user/new", routeName: "user_onboarding", surface: "app" },
  { path: "/app/rooms", routeName: "circles", surface: "app" },
  { path: "/app/rooms/new", routeName: "circle_onboarding", surface: "app" },
  { path: "/app/rooms/:roomId/settings", routeName: "circle_settings", surface: "app" },
  { path: "/app/rooms/:roomId/profile", routeName: "circle_profile_onboarding", surface: "app" },
  { path: "/app/rooms/:roomId/notes", routeName: "circle_notes", surface: "app" },
  { path: "/app/rooms/:roomId/invites", routeName: "circle_invites", surface: "app" },
  { path: "/app/board/:boardId", routeName: "board", surface: "app" },
  { path: "/app/note/:pageId", routeName: "note_detail", surface: "app" },
  { path: "/app/entries/:entryId", routeName: "post_thread", surface: "app" },
  { path: "/app/entries/:entryId/new-reply", routeName: "reply_composer", surface: "app" },
  { path: "/app/square/:squareId/new-post", routeName: "post_composer", surface: "app" },
  { path: "/app/square/:squareId", routeName: "square", surface: "app" },
];

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function matchRoutePath(pattern: string, pathname: string): { params: Record<string, string> } | null {
  const patternSegments = pattern.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  if (patternSegments.length !== pathSegments.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];
    const pathSegment = pathSegments[index];
    if (!patternSegment || !pathSegment) return null;
    if (patternSegment.startsWith(":")) {
      params[patternSegment.slice(1)] = safeDecode(pathSegment);
      continue;
    }
    if (patternSegment !== pathSegment) return null;
  }

  return { params };
}

export function resolveAnalyticsRoute(pathname: string, search = ""): AnalyticsProperties {
  for (const route of ROUTES) {
    const match = matchRoutePath(route.path, pathname);
    if (!match) continue;
    const searchParams = new URLSearchParams(search);
    return {
      surface: route.surface,
      route_name: route.routeName,
      room_id: match.params.roomId ?? searchParams.get("communityId") ?? null,
      board_id: match.params.boardId ?? searchParams.get("boardId") ?? null,
      square_id: match.params.squareId ?? searchParams.get("square_id") ?? null,
      entry_id: match.params.entryId ?? null,
      page_id: match.params.pageId ?? null,
      note_id: match.params.pageId ?? null,
    };
  }

  return {
    surface: pathname.startsWith("/app") ? "app" : "site",
    route_name: "unknown",
  };
}
