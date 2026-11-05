import posthog from 'posthog-js';
import { analyticsRoute } from './analyticsRoute';
let initialized = false;
let identity: string | null = null;
let lastScreen = '';
function client() {
  if (typeof window === 'undefined') return null;
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  if (!key || (process.env.NODE_ENV !== 'production' && process.env.EXPO_PUBLIC_POSTHOG_ENABLE_IN_DEV !== 'true')) return null;
  if (!initialized) {
    posthog.init(key, {
      api_host: process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      autocapture: false, capture_pageview: false, capture_pageleave: false,
      disable_session_recording: true, capture_performance: false,
      capture_exceptions: false, person_profiles: 'identified_only',
      property_denylist: ['$current_url', '$pathname', '$referrer', '$initial_current_url', '$initial_pathname', '$initial_referrer', '$session_entry_url', '$session_entry_pathname', '$session_entry_referrer', '$screen_name'],
      before_send: event => {
        if (!event) return null;
        // SDK-generated URL and campaign properties may contain invite tokens.
        const scrub = (properties: Record<string, unknown>) => {
          for (const key of Object.keys(properties)) {
            if (/url|pathname|referrer|utm_|gclid|fbclid/i.test(key)) delete properties[key];
            else if ((key === '$set' || key === '$set_once') && properties[key] && typeof properties[key] === 'object')
              scrub(properties[key] as Record<string, unknown>);
          }
        };
        scrub(event.properties);
        return event;
      },
    });
    posthog.register({ surface: 'app', platform: 'web', environment: process.env.NODE_ENV, analytics_version: 1 });
    // Error messages can contain document text or URLs. Record only the class.
    window.addEventListener('error', () => captureError('unhandled_error'));
    window.addEventListener('unhandledrejection', () => captureError('unhandled_rejection'));
    initialized = true;
  }
  return posthog;
}
function captureError(kind: string) {
  try { posthog.capture('app_error', { error_kind: kind }); } catch { /* Do not recurse through error handlers. */ }
}
export function syncAnalyticsIdentity(userId: string | null): void {
  try {
    const ph = client();
    if (!ph) return;
    const previous = ph.get_distinct_id();
    // Preserve a returning user's session, but never merge two signed-in accounts.
    const hadUser = identity !== null || /^\d+$/.test(previous);
    if (hadUser && previous !== userId) ph.reset();
    if (identity !== userId) lastScreen = '';
    identity = userId;
    if (userId) ph.identify(userId);
  } catch { /* Analytics must not prevent authentication or navigation. */ }
}
export function trackScreen(path: string): void {
  try {
    const ph = client();
    if (!ph) return;
    const properties = analyticsRoute(path);
    const signature = JSON.stringify(properties);
    if (signature === lastScreen) return;
    ph.capture('screen_viewed', properties);
    lastScreen = signature;
  } catch { /* Analytics is best effort. */ }
}

export function trackUpload(outcome: 'started' | 'succeeded' | 'failed', mediaType: string, targetType: string, durationMs?: number): void {
  try { client()?.capture('attachment_upload_' + outcome, { media_type: mediaType, target_type: targetType, duration_ms: durationMs }); } catch { /* best effort */ }
}
