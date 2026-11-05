import { describe, expect, it, vi } from "vitest"
import { firstExternalLinkFromContent } from "@server/api/v1/link-previews/link-preview-content"
import {
  assertSafeDestination,
  LinkPreviewsService,
  metadataFromHtml,
  youtubeVideoIdFromUrl,
} from "@server/api/v1/link-previews/link-previews.service"

describe("link preview metadata", () => {
  it("parses open graph metadata with relative assets", () => {
    const result = metadataFromHtml(
      `
        <html>
          <head>
            <meta property="og:title" content="A Fire Notes" />
            <meta property="og:description" content="A useful thing &amp; more" />
            <meta property="og:site_name" content="A Fire" />
            <meta property="og:image" content="/cover.png" />
            <meta name="theme-color" content="#336699" />
          </head>
        </html>
      `,
      "https://example.com/posts/1",
    )

    expect(result).toMatchObject({
      title: "A Fire Notes",
      description: "A useful thing & more",
      siteName: "A Fire",
      imageUrl: "https://example.com/cover.png",
      faviconUrl: "https://example.com/favicon.ico",
      accentColor: "#336699",
    })
  })

  it("blocks local network preview targets", async () => {
    await expect(assertSafeDestination("http://localhost:3000")).rejects.toMatchObject({ code: "blocked_host" })
    await expect(assertSafeDestination("http://127.0.0.1/private")).rejects.toMatchObject({ code: "blocked_host" })
    await expect(assertSafeDestination("http://[::1]/private")).rejects.toMatchObject({ code: "blocked_host" })
  })

  it.each([
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.1.2.3",
    "::ffff:172.16.0.1", "::ffff:192.168.1.1", "::ffff:169.254.169.254",
    "0:0:0:0:0:ffff:7f00:1", "::", "fe90::1",
  ])("blocks embedded and non-public IPv6 destinations: %s", async (host) => {
    await expect(assertSafeDestination(`http://[${host}]/private`)).rejects.toMatchObject({ code: "blocked_host" })
  })

  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=4", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("recognizes YouTube video URLs", (url, videoId) => {
    expect(youtubeVideoIdFromUrl(url)).toBe(videoId)
  })

  it("extracts the first unsuppressed external link from TipTap content", () => {
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "First https://one.example/path then " },
            { type: "text", text: "two", marks: [{ type: "link", attrs: { href: "https://two.example/" } }] },
          ],
        },
      ],
    }

    expect(firstExternalLinkFromContent(content)).toBe("https://one.example/path")
    expect(firstExternalLinkFromContent(content, ["https://one.example/path"])).toBe("https://two.example/")
  })

  it("trims punctuation that follows bare URLs", () => {
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Read https://example.com/posts/1)." }],
        },
      ],
    }

    expect(firstExternalLinkFromContent(content)).toBe("https://example.com/posts/1")
  })
})

describe("LinkPreviewsService resolution", () => {
  it("rechecks redirects before fetching mapped internal addresses", async () => {
    const service = new LinkPreviewsService();
    (service as any).prisma = { linkPreview: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(({ data }) => ({ id: 1, ...data })),
    } };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, {
      status: 302, headers: { location: "http://[::ffff:169.254.169.254]/private" },
    }));
    try {
      const result = await service.resolve("https://93.184.216.34/");
      expect(result).toMatchObject({ status: "failed", error_code: "blocked_host" });
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally { fetchMock.mockRestore(); }
  });

  it("uses YouTube oEmbed metadata for a reliable title and thumbnail", async () => {
    const service = new LinkPreviewsService()
    const create = vi.fn().mockImplementation(({ data }) => ({ id: 12, ...data }))
    ;(service as any).prisma = {
      linkPreview: {
        findUnique: vi.fn().mockResolvedValue(null),
        create,
      },
    }
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        title: "A useful video",
        author_name: "A Fire",
        thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    const result = await service.resolve("https://youtu.be/dQw4w9WgXcQ")

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("youtube.com/oembed")
    expect(result).toMatchObject({
      status: "ready",
      title: "A useful video",
      site_name: "YouTube",
      image_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    })
    fetchMock.mockRestore()
  })
})

describe("LinkPreviewsService attachments", () => {
  it("creates a visible attachment for the first link in content", async () => {
    const service = new LinkPreviewsService()
    const create = vi.fn().mockImplementation(({ data }) => ({
      id: 1,
      ...data,
      preview: {
        id: 9,
        url: data.source_url,
        canonical_url: data.source_url,
        title: "Preview title",
        status: "ready",
      },
    }))
    ;(service as any).prisma = {
      linkPreviewAttachment: {
        findFirst: vi.fn().mockResolvedValue(null),
        create,
      },
    }
    vi.spyOn(service, "resolve").mockResolvedValue({
      id: 9,
      url: "https://example.com/",
      canonical_url: "https://example.com/",
      title: "Preview title",
      status: "ready",
    })

    const result = await service.upsertAttachment("Post", 5, null, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "https://example.com" }] }],
    })

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          owner_type: "Post",
          owner_id: 5,
          source_url: "https://example.com/",
          preview_id: 9,
          hidden: false,
        }),
      }),
    )
    expect(result?.preview?.title).toBe("Preview title")
  })
})
