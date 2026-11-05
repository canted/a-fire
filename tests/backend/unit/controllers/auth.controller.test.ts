import { describe, expect, it, vi } from "vitest"
import { AuthController } from "@server/api/v1/auth/auth.controller"
import { MEDIA_AUTH_COOKIE_NAME } from "@server/api/v1/auth/media-auth-cookie"

describe("AuthController", () => {
  it("refreshes the media auth cookie from the current bearer token", () => {
    const controller = new AuthController()
    const response = { cookie: vi.fn() }

    controller.refreshMediaCookie(
      {
        headers: { authorization: "Bearer access-token" },
        user: { id: 7 },
      } as never,
      response as never,
    )

    expect(response.cookie).toHaveBeenCalledWith(
      MEDIA_AUTH_COOKIE_NAME,
      "access-token",
      expect.objectContaining({
        httpOnly: true,
        path: "/api/v1",
      }),
    )
  })
})
