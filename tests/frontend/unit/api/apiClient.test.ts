import { ApiClient } from "../../../../frontend/site/lib/api/client";

function base64Url(input: string) {
  return Buffer.from(input).toString("base64url");
}

function makeToken(expSecondsFromNow: number) {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  const payload = base64Url(JSON.stringify({ sub: "1", exp }));
  return `${header}.${payload}.signature`;
}

describe("ApiClient refresh behavior", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("dedupes concurrent refresh calls", async () => {
    const client = new ApiClient("https://example.test");
    const accessToken = makeToken(60);
    localStorage.setItem("accessToken", accessToken);
    localStorage.setItem("refreshToken", "refresh-1");

    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/v1/auth/refresh")) {
        refreshCalls += 1;
        return new Response(JSON.stringify({ accessToken: "new-access", refreshToken: "refresh-2" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([client.get("/v1/boards/1"), client.get("/v1/boards/1")]);

    expect(refreshCalls).toBe(1);
  });

  it("refreshes when realtime asks for a token without a current access token", async () => {
    const client = new ApiClient("https://example.test");
    localStorage.setItem("refreshToken", "refresh-1");

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ accessToken: "new-access", refreshToken: "refresh-2" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(client.getAccessToken()).resolves.toBe("new-access");
    expect(localStorage.getItem("accessToken")).toBe("new-access");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v1/auth/refresh",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ refreshToken: "refresh-1" }),
      }),
    );
  });

  it("can force refresh a realtime token after websocket authentication fails", async () => {
    const client = new ApiClient("https://example.test");
    localStorage.setItem("accessToken", makeToken(60 * 60));
    localStorage.setItem("refreshToken", "refresh-1");

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ accessToken: "new-access", refreshToken: "refresh-2" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(client.getAccessToken({ forceRefresh: true })).resolves.toBe("new-access");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes the media auth cookie for an existing access token", async () => {
    const client = new ApiClient("https://example.test/api");
    const accessToken = makeToken(60 * 60);
    localStorage.setItem("accessToken", accessToken);

    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await client.refreshMediaAuthCookie();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/api/v1/auth/media",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          Authorization: `Bearer ${accessToken}`,
        }),
      }),
    );
  });

  it("does not request media auth without a stored session", async () => {
    const client = new ApiClient("https://example.test/api");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await client.refreshMediaAuthCookie();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses same-origin credentials for blob requests so signed storage redirects do not become credentialed CORS requests", async () => {
    const client = new ApiClient("https://afire.app/api");
    const accessToken = makeToken(60 * 60);
    localStorage.setItem("accessToken", accessToken);
    const fetchMock = vi.fn(async () => {
      return new Response(new Blob(["audio"]), {
        status: 200,
        headers: { "content-type": "audio/mp4" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await client.getBlob("/v1/audio-assets/5/download");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://afire.app/api/v1/audio-assets/5/download",
      expect.objectContaining({
        credentials: "same-origin",
        headers: expect.objectContaining({
          Authorization: `Bearer ${accessToken}`,
        }),
      }),
    );
  });

  it("does not duplicate the API prefix for backend-returned blob URLs", async () => {
    const client = new ApiClient("https://afire.app/api");
    const accessToken = makeToken(60 * 60);
    localStorage.setItem("accessToken", accessToken);
    const fetchMock = vi.fn(async () => {
      return new Response(new Blob(["audio"]), {
        status: 200,
        headers: { "content-type": "audio/mp4" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await client.getBlob("/api/v1/audio-assets/5/download");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://afire.app/api/v1/audio-assets/5/download",
      expect.objectContaining({
        credentials: "same-origin",
        headers: expect.objectContaining({
          Authorization: `Bearer ${accessToken}`,
        }),
      }),
    );
  });

  it("does not duplicate the API prefix for relative backend-returned blob URLs", async () => {
    const client = new ApiClient("/api");
    const accessToken = makeToken(60 * 60);
    localStorage.setItem("accessToken", accessToken);
    const fetchMock = vi.fn(async () => {
      return new Response(new Blob(["audio"]), {
        status: 200,
        headers: { "content-type": "audio/mp4" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await client.getBlob("/api/v1/audio-assets/5/download");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/audio-assets/5/download",
      expect.objectContaining({
        credentials: "same-origin",
        headers: expect.objectContaining({
          Authorization: `Bearer ${accessToken}`,
        }),
      }),
    );
  });
});

describe("ApiClient error messages", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["json", "blob"] as const)("preserves the actionable Nest error message and status for %s requests", async (kind) => {
    const message = "Sign in with the email that received this invitation, then reopen the invite link.";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message, error: "Forbidden", statusCode: 403 }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })));
    const client = new ApiClient("https://example.test/api");
    const request = kind === "json"
      ? client.post("/v1/auth/invites/accept", { token: "example-invite" })
      : client.getBlob("/v1/audio-assets/5/download");

    await expect(request).rejects.toMatchObject({ message, status: 403 });
    expect(localStorage.getItem("accessToken")).toBeNull();
  });

  it.each([undefined, " "])("keeps legacy error text when the message field is %j", async (message) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message, error: "Invite not found." }), {
      status: 404,
      headers: { "content-type": "application/json" },
    })));
    const client = new ApiClient("https://example.test/api");

    await expect(client.post("/v1/auth/invites/accept", { token: "missing-invite" }))
      .rejects.toMatchObject({ message: "Invite not found.", status: 404 });
  });
});
