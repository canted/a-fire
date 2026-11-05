import { describe, expect, it } from "vitest";
import {
  circleIconUrl,
  extractPrivateUploadBlobIds,
  findUnsupportedMediaSrcs,
  normalizePrivateUploadUrl,
  normalizePrivateUploadUrls,
  normalizePrivateUploadUrlsInString,
  postFormatDataVariantUrls,
  tiptapImageVariantUrls,
  uploadVariantUrl,
  userAvatarUrl,
} from "@server/api/v1/uploads/upload-urls";

describe("upload url helpers", () => {
  const railsBlob44Url =
    "https://afire.app/rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NDQsInB1ciI6ImJsb2JfaWQifX0=--6e85a17f83d26cdd6191a2027f4fc00a044d303b/IMG_1274.jpeg";

  it("normalizes legacy absolute app upload URLs to same-origin paths", () => {
    expect(normalizePrivateUploadUrl("http://afire.app/api/v1/uploads/114")).toBe("/api/v1/uploads/114");
    expect(normalizePrivateUploadUrl("https://www.afire.app/api/v1/uploads/114/variants/w600?cache=1#x")).toBe(
      "/api/v1/uploads/114/variants/w600?cache=1#x",
    );
    expect(normalizePrivateUploadUrl("http://localhost:4000/api/v1/uploads/140/variants/w1200")).toBe(
      "/api/v1/uploads/140/variants/w1200",
    );
    expect(normalizePrivateUploadUrl("http://127.0.0.1:4000/api/v1/uploads/140")).toBe("/api/v1/uploads/140");
  });

  it("does not rewrite non-app upload lookalikes", () => {
    expect(normalizePrivateUploadUrl("https://example.com/api/v1/uploads/114")).toBe(
      "https://example.com/api/v1/uploads/114",
    );
    expect(normalizePrivateUploadUrl("https://afire.app/not-uploads/114")).toBe("https://afire.app/not-uploads/114");
  });

  it("normalizes legacy Rails Active Storage blob URLs to private upload paths", () => {
    expect(normalizePrivateUploadUrl(railsBlob44Url)).toBe("/api/v1/uploads/44");
    expect(normalizePrivateUploadUrlsInString(`<img src="${railsBlob44Url}">`)).toBe('<img src="/api/v1/uploads/44">');
  });

  it("replaces legacy absolute URLs inside stored HTML strings", () => {
    expect(
      normalizePrivateUploadUrlsInString(
        '<img src="http://afire.app/api/v1/uploads/114" contenteditable="false" draggable="true">',
      ),
    ).toBe('<img src="/api/v1/uploads/114" contenteditable="false" draggable="true">');
  });

  it("normalizes nested Tiptap content without mutating unchanged external URLs", () => {
    const content = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "http://afire.app/api/v1/uploads/114" } },
        { type: "image", attrs: { src: "https://example.com/api/v1/uploads/115" } },
      ],
    };

    const result = normalizePrivateUploadUrls(content);

    expect(result.changed).toBe(true);
    expect(result.value).toEqual({
      type: "doc",
      content: [
        { type: "image", attrs: { src: "/api/v1/uploads/114" } },
        { type: "image", attrs: { src: "https://example.com/api/v1/uploads/115" } },
      ],
    });
  });

  it("keeps variant URLs protected and same-origin", () => {
    expect(uploadVariantUrl("http://afire.app/api/v1/uploads/114", "w600")).toBe(
      "/api/v1/uploads/114/variants/w600",
    );
    expect(uploadVariantUrl("http://afire.app/api/v1/uploads/114/variants/w1200?x=1", "icon96")).toBe(
      "/api/v1/uploads/114/variants/icon96?x=1",
    );

    expect(
      tiptapImageVariantUrls(
        { type: "doc", content: [{ type: "image", attrs: { src: "http://afire.app/api/v1/uploads/114" } }] },
        "w600",
      ),
    ).toEqual({ type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/114/variants/w600" } }] });
  });

  it("uses responsive variants for app-owned typed-post images", () => {
    expect(
      postFormatDataVariantUrls(
        {
          image_url: "http://afire.app/api/v1/uploads/114/variants/w1200",
          thumbnail_url: "/api/v1/uploads/115",
          title: "Night fire",
        },
        "w600",
      ),
    ).toEqual({
      image_url: "/api/v1/uploads/114/variants/w600",
      thumbnail_url: "/api/v1/uploads/115/variants/w600",
      title: "Night fire",
    });

    expect(
      postFormatDataVariantUrls(
        { image_url: "https://images.example.com/night-fire.jpg" },
        "w600",
      ),
    ).toEqual({ image_url: "https://images.example.com/night-fire.jpg" });
  });

  it("uses one canonical variant URL for circle and user identity images", () => {
    expect(circleIconUrl("/api/v1/uploads/44")).toBe("/api/v1/uploads/44/variants/icon160");
    expect(circleIconUrl("/api/v1/uploads/44/variants/icon96")).toBe(
      "/api/v1/uploads/44/variants/icon160",
    );
    expect(userAvatarUrl("/api/v1/uploads/45")).toBe(
      "/api/v1/uploads/45/variants/avatarStripe40",
    );
  });

  it("extracts only app-owned private upload ids", () => {
    expect(
      extractPrivateUploadBlobIds({
        html: '<img src="http://afire.app/api/v1/uploads/114"><img src="https://evil.example/api/v1/uploads/115">',
        src: "/api/v1/uploads/116/variants/w600",
        legacy: railsBlob44Url,
      }),
    ).toEqual([114, 116, 44]);
  });

  it("finds browser-local and inline media sources in Tiptap content", () => {
    expect(
      findUnsupportedMediaSrcs({
        type: "doc",
        content: [
          { type: "image", attrs: { src: "blob:https://afire.app/aa3f1838-5ff2-4758-a339-862b12c9772d" } },
          { type: "image", attrs: { src: "data:image/png;base64,abc" } },
          { type: "video", attrs: { playbackUrl: "blob:https://afire.app/local-video" } },
          { type: "image", attrs: { src: "/api/v1/uploads/44" } },
          { type: "paragraph", content: [{ type: "text", text: "blob:https://afire.app/not-an-image" }] },
        ],
      }),
    ).toEqual([
      "blob:https://afire.app/aa3f1838-5ff2-4758-a339-862b12c9772d",
      "data:image/png;base64,abc",
      "blob:https://afire.app/local-video",
    ]);
  });
});
