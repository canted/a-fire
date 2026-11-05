import posthog, { type PostHog } from "posthog-js";
import { randomUuid } from "../../src/lib/randomId";

export type AnalyticsSurface = "site" | "app";

export type AnalyticsRouteName =
  | "site_home"
  | "auth_request_otp"
  | "auth_verify_otp"
  | "auth_accept_invite"
  | "app_home_redirect"
  | "profile"
  | "notification_preferences"
  | "notices"
  | "post_composer"
  | "user_onboarding"
  | "communities"
  | "community_onboarding"
  | "community_settings"
  | "community_profile_onboarding"
  | "community_pages"
  | "community_invites"
  | "circles"
  | "circle_onboarding"
  | "circle_settings"
  | "circle_profile_onboarding"
  | "circle_notes"
  | "circle_invites"
  | "board"
  | "page_detail"
  | "note_detail"
  | "post_thread"
  | "reply_composer"
  | "square"
  | "unknown";

export type AnalyticsEventName =
  | "screen_viewed"
  | "invite_landing_viewed"
  | "invite_accept_clicked"
  | "invite_accept_failed"
  | "default_identity_started"
  | "default_identity_completed"
  | "community_identity_customized"
  | "community_identity_skipped"
  | "member_first_live_landing"
  | "community_onboarding_started"
  | "invites_viewed"
  | "install_prompt_shown"
  | "install_prompt_acknowledged"
  | "install_prompt_accepted"
  | "install_prompt_dismissed"
  | "app_installed"
  | "notification_prompt_shown"
  | "notification_prompt_enabled"
  | "notification_prompt_dismissed"
  | "notification_permission_denied"
  | "push_subscription_enabled"
  | "push_subscription_disabled"
  | "notification_preferences_updated"
  | "notification_activation_updated"
  | "post_composer_opened"
  | "reply_composer_opened"
  | "page_composer_opened";

export type NotificationPermissionProperty = NotificationPermission | "unsupported";

export type AnalyticsProperties = {
  surface?: AnalyticsSurface;
  route_name?: AnalyticsRouteName;
  room_id?: string | number | null;
  board_id?: string | number | null;
  square_id?: string | number | null;
  entry_id?: string | number | null;
  reply_id?: string | number | null;
  feedback_type?: string | null;
  page_id?: string | number | null;
  note_id?: string | number | null;
  invite_id?: string | number | null;
  invite_type?: "room_invite" | "new_room_invite";
  invite_token_present?: boolean;
  source?: string;
  trigger?: string;
  platform?: string;
  is_new_user?: boolean;
  is_installed?: boolean;
  notification_permission?: NotificationPermissionProperty;
  notification_type?: string;
  notification_activation_id?: string | null;
  notification_activation_state?: string;
  notification_destination?: string;
  notification_current_location?: string;
  client_build_id?: string | null;
  has_avatar?: boolean;
  reason_code?: string;
  signup_method?: string;
  first_community_id?: string | number | null;
  membership_count?: number;
  has_installed_pwa?: boolean;
  notifications_enabled?: boolean;
  content_block_count?: number;
  text_char_count?: number;
  attachment_count?: number;
  attachment_types?: string[];
  has_audio?: boolean;
  has_image?: boolean;
  has_video?: boolean;
  has_link?: boolean;
  duration_ms?: number;
};

const ANONYMOUS_ID_KEY = "analytics.anonymous_id";
const ALIASED_USER_ID_KEY = "analytics.aliased_user_id";

function analyticsEnabled() {
  return Boolean(import.meta.env.VITE_POSTHOG_KEY);
}

function safePosthog(): PostHog | null {
  if (!analyticsEnabled()) return null;
  return posthog;
}

function compactProperties(properties?: AnalyticsProperties): AnalyticsProperties | undefined {
  if (!properties) return undefined;
  return Object.entries(properties).reduce<AnalyticsProperties>((acc, [key, value]) => {
    if (value !== undefined) {
      (acc as Record<string, unknown>)[key] = value;
    }
    return acc;
  }, {});
}

function randomId() {
  return `anon_${randomUuid()}`;
}

export function getAnonymousDistinctId(): string {
  if (typeof window === "undefined") return randomId();
  const existing = window.localStorage.getItem(ANONYMOUS_ID_KEY);
  if (existing) return existing;
  const nextId = randomId();
  window.localStorage.setItem(ANONYMOUS_ID_KEY, nextId);
  return nextId;
}

export function bootstrapAnalytics(): void {
  const client = safePosthog();
  if (!client || typeof window === "undefined") return;
  const hasAccessToken = Boolean(window.localStorage.getItem("accessToken"));
  if (!hasAccessToken) {
    client.identify(getAnonymousDistinctId());
  }
}

export function captureEvent(name: AnalyticsEventName, properties?: AnalyticsProperties): void {
  const client = safePosthog();
  if (!client) return;
  client.capture(name, compactProperties(properties));
}

export function identifyUser(userId: string | number, properties?: AnalyticsProperties): void {
  const client = safePosthog();
  if (!client) return;
  client.identify(String(userId), compactProperties(properties));
}

export function aliasAnonymousUser(userId: string | number): void {
  const client = safePosthog();
  if (!client || typeof window === "undefined") return;
  const userIdString = String(userId);
  if (window.localStorage.getItem(ALIASED_USER_ID_KEY) === userIdString) return;
  client.alias(userIdString, getAnonymousDistinctId());
  window.localStorage.setItem(ALIASED_USER_ID_KEY, userIdString);
}

export function identifyAuthenticatedUser(accessToken?: string | null, properties?: AnalyticsProperties): void {
  const userId = subjectFromJwt(accessToken);
  if (!userId) return;
  aliasAnonymousUser(userId);
  identifyUser(userId, properties);
}

export function resetAnalytics(): void {
  const client = safePosthog();
  if (!client || typeof window === "undefined") return;
  client.reset();
  window.localStorage.removeItem(ALIASED_USER_ID_KEY);
  client.identify(getAnonymousDistinctId());
}

export function setCommunityGroup(contextRoomId: string | number | null): void {
  const client = safePosthog();
  if (!client) return;
  if (contextRoomId === null) {
    (client as PostHog & { resetGroups?: () => void }).resetGroups?.();
    return;
  }
  const roomIdString = String(contextRoomId);
  client.group("community", `community:${roomIdString}`, { room_id: roomIdString });
}

function subjectFromJwt(token?: string | null): string | null {
  if (!token || typeof window === "undefined") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = window.atob(encoded.padEnd(encoded.length + ((4 - (encoded.length % 4)) % 4), "="));
    const payload = JSON.parse(decoded) as { sub?: unknown };
    return typeof payload.sub === "string" || typeof payload.sub === "number" ? String(payload.sub) : null;
  } catch {
    return null;
  }
}
