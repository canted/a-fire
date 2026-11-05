import { beforeEach, describe, expect, it, vi } from "vitest";

describe("env", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  it("reads meta content for the vapid key", async () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "vapid-public-key");
    meta.setAttribute("content", "abc123");
    document.head.appendChild(meta);

    vi.resetModules();
    const { env } = await import("../../../../frontend/site/lib/env");

    expect(env.vapidPublicKey).toBe("abc123");
  });

  it("derives api base url and enable mocks from env", async () => {
    vi.resetModules();
    const { env } = await import("../../../../frontend/site/lib/env");

    expect(env.apiBaseUrl).toBe("/api");
    expect(env.enableMocks).toBe(false);
  });
});
