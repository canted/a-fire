import { readCompleteVapidConfigs, readVapidConfig, readVapidPublicKey } from "@server/runtime/vapid";

describe("runtime/vapid", () => {
  it("prefers VITE-prefixed VAPID keys", () => {
    const config = readVapidConfig({
      VITE_VAPID_PUBLIC_KEY: "vite-public",
      VITE_VAPID_PRIVATE_KEY: "vite-private",
      VITE_VAPID_SUBJECT: "mailto:vite@example.com",
      VAPID_PUBLIC_KEY: "legacy-public",
      VAPID_PRIVATE_KEY: "legacy-private",
      VAPID_SUBJECT: "mailto:legacy@example.com",
    });

    expect(config).toEqual({
      publicKey: "vite-public",
      privateKey: "vite-private",
      subject: "mailto:vite@example.com",
    });
  });

  it("falls back to legacy VAPID keys", () => {
    const config = readVapidConfig({
      VAPID_PUBLIC_KEY: "legacy-public",
      VAPID_PRIVATE_KEY: "legacy-private",
      BREVO_SENDER: "sender@example.com",
    });

    expect(config).toEqual({
      publicKey: "legacy-public",
      privateKey: "legacy-private",
      subject: "mailto:sender@example.com",
    });
  });

  it("returns complete VAPID configs in retry order", () => {
    expect(
      readCompleteVapidConfigs({
        VITE_VAPID_PUBLIC_KEY: "vite-public",
        VITE_VAPID_PRIVATE_KEY: "vite-private",
        VAPID_PUBLIC_KEY: "legacy-public",
        VAPID_PRIVATE_KEY: "legacy-private",
        BREVO_SENDER: "sender@example.com",
      }),
    ).toEqual([
      {
        publicKey: "vite-public",
        privateKey: "vite-private",
        subject: "mailto:sender@example.com",
        source: "vite",
      },
      {
        publicKey: "legacy-public",
        privateKey: "legacy-private",
        subject: "mailto:sender@example.com",
        source: "legacy",
      },
    ]);
  });

  it("ignores empty and unresolved placeholder public keys", () => {
    expect(readVapidPublicKey({ VITE_VAPID_PUBLIC_KEY: " %VITE_VAPID_PUBLIC_KEY% " })).toBeUndefined();
    expect(readVapidPublicKey({ VITE_VAPID_PUBLIC_KEY: "", VAPID_PUBLIC_KEY: "legacy-public" })).toBe(
      "legacy-public",
    );
  });
});
