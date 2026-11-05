import { vi } from "vitest";

const captureMock = vi.fn();
const captureExceptionMock = vi.fn();
const shutdownMock = vi.fn();
const posthogCtor = vi.fn();

class PostHogMock {
  constructor(apiKey: string, options?: { host?: string; enableExceptionAutocapture?: boolean }) {
    posthogCtor(apiKey, options);
  }
  capture = captureMock;
  captureException = captureExceptionMock;
  shutdown = shutdownMock;
}

vi.mock("posthog-node", () => ({
  PostHog: PostHogMock,
}));

describe("runtime/posthog", () => {
  beforeEach(() => vi.stubEnv("POSTHOG_ENABLE_IN_DEV", "true"));
  afterEach(() => vi.unstubAllEnvs());
  it("does not send development or test activity without explicit opt-in", async () => {
    vi.stubEnv("POSTHOG_ENABLE_IN_DEV", "false");
    process.env.POSTHOG_KEY = "test-key";
    const mod = await import("@server/runtime/posthog");
    expect(mod.getPosthogClient()).toBeNull();
  });
  const originalServerKey = process.env.POSTHOG_KEY;
  const originalServerHost = process.env.POSTHOG_HOST;
  const originalKey = process.env.VITE_POSTHOG_KEY;
  const originalHost = process.env.VITE_POSTHOG_HOST;

  afterEach(() => {
    restoreEnv("POSTHOG_KEY", originalServerKey);
    restoreEnv("POSTHOG_HOST", originalServerHost);
    restoreEnv("VITE_POSTHOG_KEY", originalKey);
    restoreEnv("VITE_POSTHOG_HOST", originalHost);
    vi.resetModules();
    captureMock.mockClear();
    captureExceptionMock.mockClear();
    shutdownMock.mockClear();
    posthogCtor.mockClear();
  });

  it("returns null when key missing", async () => {
    delete process.env.POSTHOG_KEY;
    delete process.env.VITE_POSTHOG_KEY;
    const mod = await import("@server/runtime/posthog");
    expect(mod.getPosthogClient()).toBeNull();
  });

  it("creates client with server-safe host", async () => {
    process.env.POSTHOG_KEY = "server-key";
    process.env.POSTHOG_HOST = "https://server-host";
    process.env.VITE_POSTHOG_KEY = "vite-key";
    process.env.VITE_POSTHOG_HOST = "https://vite-host";
    const mod = await import("@server/runtime/posthog");

    const client = mod.getPosthogClient();

    expect(client).not.toBeNull();
    expect(posthogCtor).toHaveBeenCalledWith("server-key", {
      enableExceptionAutocapture: true,
      host: "https://server-host",
    });
  });

  it("falls back to legacy vite env names", async () => {
    delete process.env.POSTHOG_KEY;
    delete process.env.POSTHOG_HOST;
    process.env.VITE_POSTHOG_KEY = "key";
    process.env.VITE_POSTHOG_HOST = "https://host";
    const mod = await import("@server/runtime/posthog");

    const client = mod.getPosthogClient();

    expect(client).not.toBeNull();
    expect(posthogCtor).toHaveBeenCalledWith("key", {
      enableExceptionAutocapture: true,
      host: "https://host",
    });
  });

  it("captures events with normalized props", async () => {
    process.env.VITE_POSTHOG_KEY = "key";
    const mod = await import("@server/runtime/posthog");

    mod.capturePosthogEvent({ distinctId: 1, event: "evt", properties: { count: 2 } });

    expect(captureMock).toHaveBeenCalledWith({
      distinctId: "1",
      event: "evt",
      properties: { count: 2, environment: "test", analytics_version: 1, deployment: "local" },
    });
  });

  it("captures exceptions with normalized context", async () => {
    process.env.POSTHOG_KEY = "key";
    const mod = await import("@server/runtime/posthog");
    const error = new Error("boom");

    mod.capturePosthogException({
      error,
      distinctId: 1,
      properties: { count: 2, nested: { value: 3 } },
    });

    expect(captureExceptionMock).toHaveBeenCalledWith(error, "1", {
      count: 2,
      nested: { value: 3 },
    });
  });

  it("captures Entry publish events with derived content stats", async () => {
    process.env.POSTHOG_KEY = "key";
    const mod = await import("@server/runtime/posthog");

    mod.capturePostPublished({
      userId: 1,
      entryId: 2,
      roomId: 5,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "hello", marks: [{ type: "link" }] }] },
          { type: "image", attrs: { src: "https://example.com/image.png" } },
          { type: "audio", attrs: { audioAssetId: 9 } },
          { type: "video", attrs: { videoAssetId: 10 } },
        ],
      },
    });

    expect(captureMock).toHaveBeenCalledWith({
      distinctId: "1",
      event: "post_published",
      properties: expect.objectContaining({
        entry_id: 2,
        room_id: 5,
        content_block_count: 4,
        text_char_count: 5,
        attachment_count: 3,
        attachment_types: ["audio", "image", "video"],
        has_audio: true,
        has_image: true,
        has_video: true,
        has_link: true,
      }),
    });
  });

  it("shuts down client", async () => {
    process.env.VITE_POSTHOG_KEY = "key";
    const mod = await import("@server/runtime/posthog");
    mod.capturePosthogEvent({ distinctId: "1", event: "evt" });

    await mod.shutdownPosthog();

    expect(shutdownMock).toHaveBeenCalled();
    const client = mod.getPosthogClient();
    expect(client).not.toBeNull();
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
