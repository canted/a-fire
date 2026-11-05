import { beforeEach, describe, expect, it, vi } from "vitest";

const { posthogMock } = vi.hoisted(() => ({
  posthogMock: {
    capture: vi.fn(),
    identify: vi.fn(),
    alias: vi.fn(),
    reset: vi.fn(),
    group: vi.fn(),
  },
}));

vi.mock("../../../../frontend/node_modules/posthog-js", () => ({
  default: posthogMock,
}));

import {
  aliasAnonymousUser,
  captureEvent,
  identifyAuthenticatedUser,
  identifyUser,
  resetAnalytics,
  setCommunityGroup,
} from "../../../../frontend/site/lib/analytics";

describe("frontend analytics wrapper", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("VITE_POSTHOG_KEY", "key");
    localStorage.clear();
    Object.values(posthogMock).forEach((mock) => mock.mockClear());
  });

  it("no-ops when PostHog is not configured", () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "");

    captureEvent("screen_viewed", { route_name: "site_home" });
    identifyUser(1);
    aliasAnonymousUser(1);
    resetAnalytics();
    setCommunityGroup(1);

    expect(posthogMock.capture).not.toHaveBeenCalled();
    expect(posthogMock.identify).not.toHaveBeenCalled();
    expect(posthogMock.alias).not.toHaveBeenCalled();
    expect(posthogMock.reset).not.toHaveBeenCalled();
    expect(posthogMock.group).not.toHaveBeenCalled();
  });

  it("captures events and compacts undefined properties", () => {
    captureEvent("screen_viewed", { route_name: "board", board_id: "2", room_id: undefined });

    expect(posthogMock.capture).toHaveBeenCalledWith("screen_viewed", { route_name: "board", board_id: "2" });
  });

  it("identifies, aliases, resets, and assigns community groups", () => {
    localStorage.setItem("analytics.anonymous_id", "anon-1");
    identifyUser(7, { signup_method: "otp" });
    aliasAnonymousUser(7);
    resetAnalytics();
    setCommunityGroup(12);

    expect(posthogMock.identify).toHaveBeenCalledWith("7", { signup_method: "otp" });
    expect(posthogMock.alias).toHaveBeenCalledWith("7", "anon-1");
    expect(posthogMock.reset).toHaveBeenCalled();
    expect(posthogMock.group).toHaveBeenCalledWith("community", "community:12", { room_id: "12" });
  });

  it("identifies authenticated users from access tokens", () => {
    const token = `header.${btoa(JSON.stringify({ sub: "42" }))}.signature`;

    identifyAuthenticatedUser(token, { signup_method: "invite" });

    expect(posthogMock.alias).toHaveBeenCalledWith("42", expect.any(String));
    expect(posthogMock.identify).toHaveBeenCalledWith("42", { signup_method: "invite" });
  });
});
