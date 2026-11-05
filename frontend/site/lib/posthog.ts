import posthog, { type PostHog } from "posthog-js";
import { bootstrapAnalytics } from "./analytics";

export function initPosthog(): PostHog {
  const apiKey = import.meta.env.VITE_POSTHOG_KEY;
  const apiHost = import.meta.env.VITE_POSTHOG_HOST;
  if (apiKey && shouldInitPosthog()) {
    posthog.init(apiKey, {
      ...(apiHost ? { api_host: apiHost } : {}),
      ...posthogTracingConfig(),
      autocapture: false,
      capture_pageview: false,
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      disable_session_recording: false,
      mask_all_element_attributes: true,
      mask_all_text: true,
      mask_personal_data_properties: true,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "body",
      },
      defaults: "2025-11-30",
    });
    bootstrapAnalytics();
  }
  return posthog;
}

export function posthogTracingHosts(): string[] {
  const hosts = new Set<string>();
  addHostname(hosts, import.meta.env.VITE_API_BASE_URL);

  if (typeof window !== "undefined") {
    addHostname(hosts, window.location.origin);
  }

  return Array.from(hosts);
}

function shouldInitPosthog(): boolean {
  if (!import.meta.env.DEV) return true;
  return import.meta.env.VITE_POSTHOG_ENABLE_IN_DEV === "true";
}

function posthogTracingConfig() {
  const tracingHosts = posthogTracingHosts();
  return tracingHosts.length > 0 ? { __add_tracing_headers: tracingHosts } : {};
}

function addHostname(hosts: Set<string>, value: string | undefined) {
  if (!value) return;

  try {
    const isAbsoluteHttpUrl = /^https?:\/\//i.test(value);
    if (!isAbsoluteHttpUrl && typeof window === "undefined") return;
    const url = isAbsoluteHttpUrl ? new URL(value) : new URL(value, window.location.origin);
    if (url.protocol === "http:" || url.protocol === "https:") {
      hosts.add(url.hostname);
    }
  } catch {
    // Ignore malformed optional config; PostHog can still initialize without tracing headers.
  }
}
