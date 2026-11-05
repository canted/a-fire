import { UnauthorizedException } from "@nestjs/common";
import { vi } from "vitest";
import { MediaAuthGuard } from "@server/api/v1/auth/media-auth.guard";
import { MEDIA_AUTH_COOKIE_NAME } from "@server/api/v1/auth/media-auth-cookie";

function contextFor(headers: Record<string, string | undefined>) {
  const request: Record<string, unknown> = { headers };
  return {
    request,
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    },
  };
}

describe("MediaAuthGuard", () => {
  it("accepts bearer auth for media routes", () => {
    const guard = new MediaAuthGuard();
    const verifyAccessToken = vi.fn(() => ({ userId: 7, sessionId: "session-1" }));
    (guard as any).authService = { verifyAccessToken };
    const { context, request } = contextFor({ authorization: "Bearer token-1" });

    expect(guard.canActivate(context as never)).toBe(true);
    expect(verifyAccessToken).toHaveBeenCalledWith("token-1");
    expect(request.user).toEqual({ id: 7 });
    expect(request.sessionId).toBe("session-1");
  });

  it("accepts the media auth cookie for image tags", () => {
    const guard = new MediaAuthGuard();
    const verifyAccessToken = vi.fn(() => ({ userId: 8, sessionId: null }));
    (guard as any).authService = { verifyAccessToken };
    const { context, request } = contextFor({ cookie: `other=1; ${MEDIA_AUTH_COOKIE_NAME}=cookie-token` });

    expect(guard.canActivate(context as never)).toBe(true);
    expect(verifyAccessToken).toHaveBeenCalledWith("cookie-token");
    expect(request.user).toEqual({ id: 8 });
  });

  it("rejects unauthenticated media requests", () => {
    const guard = new MediaAuthGuard();
    (guard as any).authService = { verifyAccessToken: vi.fn() };
    const { context } = contextFor({});

    expect(() => guard.canActivate(context as never)).toThrow(UnauthorizedException);
  });
});
