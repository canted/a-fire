import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { bootstrapAnalyticsMock, posthogMock } = vi.hoisted(() => ({
  bootstrapAnalyticsMock: vi.fn(),
  posthogMock: {
    init: vi.fn(),
  },
}));

vi.mock("../../../../frontend/node_modules/posthog-js", () => ({
  default: posthogMock,
}));

vi.mock("@/lib/analytics", () => ({
  bootstrapAnalytics: bootstrapAnalyticsMock,
}));

import { initPosthog, posthogTracingHosts } from "../../../../frontend/site/lib/posthog";

describe("initPosthog", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.unstubAllEnvs();
    posthogMock.init.mockClear();
    bootstrapAnalyticsMock.mockClear();
  });

  it("does not initialize PostHog in dev by default", () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "key");
    vi.stubEnv("VITE_POSTHOG_HOST", "https://example.test");

    initPosthog();

    expect(posthogMock.init).not.toHaveBeenCalled();
    expect(bootstrapAnalyticsMock).not.toHaveBeenCalled();
  });

  it("can initialize PostHog in dev when explicitly enabled", () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "key");
    vi.stubEnv("VITE_POSTHOG_HOST", "https://example.test");
    vi.stubEnv("VITE_POSTHOG_ENABLE_IN_DEV", "true");

    initPosthog();

    expect(posthogMock.init).toHaveBeenCalledWith("key", {
      __add_tracing_headers: ["localhost"],
      api_host: "https://example.test",
      autocapture: false,
      capture_pageview: false,
      capture_exceptions: {
        capture_console_errors: false,
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
      },
      defaults: "2025-11-30",
      disable_session_recording: false,
      mask_all_element_attributes: true,
      mask_all_text: true,
      mask_personal_data_properties: true,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "body",
      },
    });
    expect(bootstrapAnalyticsMock).toHaveBeenCalled();
  });

  it("adds tracing headers for the API host and current app host", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test/api");

    expect(posthogTracingHosts()).toEqual(["api.example.test", "localhost"]);
  });
});
