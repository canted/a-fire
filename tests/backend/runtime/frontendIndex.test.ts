import { renderFrontendIndexHtml } from "@server/runtime/frontendIndex";

describe("runtime/frontendIndex", () => {
  it("injects the current frontend build id", () => {
    const html = '<html><head><title>a fire</title></head><body></body></html>';

    expect(renderFrontendIndexHtml(html, {}, { buildId: "build-1" })).toContain(
      'meta name="afire-build-id" content="build-1"',
    );
  });

  it("overrides stale frontend build ids", () => {
    const html = '<html><head><meta name="afire-build-id" content="old-build" /></head></html>';

    expect(renderFrontendIndexHtml(html, {}, { buildId: "new-build" })).toContain('content="new-build"');
  });

  it("injects the runtime VAPID public key into an empty built meta tag", () => {
    const html = '<html><head><meta name="vapid-public-key" content="" /></head><body></body></html>';

    expect(renderFrontendIndexHtml(html, { VITE_VAPID_PUBLIC_KEY: "runtime-public-key" })).toContain(
      'meta name="vapid-public-key" content="runtime-public-key"',
    );
  });

  it("overrides stale build-time VAPID public keys", () => {
    const html = '<html><head><meta name="vapid-public-key" content="stale-build-key" /></head></html>';

    expect(renderFrontendIndexHtml(html, { VAPID_PUBLIC_KEY: "legacy-runtime-key" })).toContain(
      'content="legacy-runtime-key"',
    );
  });

  it("leaves the HTML unchanged when no runtime public key is configured", () => {
    const html = '<html><head><meta name="vapid-public-key" content="" /></head></html>';

    expect(renderFrontendIndexHtml(html, {})).toBe(html);
  });

  it("can inject build and VAPID metadata in one pass", () => {
    const html = '<html><head><meta name="vapid-public-key" content="" /></head></html>';

    const rendered = renderFrontendIndexHtml(html, { VITE_VAPID_PUBLIC_KEY: "runtime-public-key" }, { buildId: "build-1" });

    expect(rendered).toContain('meta name="vapid-public-key" content="runtime-public-key"');
    expect(rendered).toContain('meta name="afire-build-id" content="build-1"');
  });
});
