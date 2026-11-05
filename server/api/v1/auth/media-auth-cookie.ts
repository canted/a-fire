import type { Response } from "express"

export const MEDIA_AUTH_COOKIE_NAME = "afire_media_token"
const MEDIA_AUTH_COOKIE_TTL_SECONDS = 60 * 60

export function setMediaAuthCookie(response: Response, accessToken: string) {
  response.cookie(MEDIA_AUTH_COOKIE_NAME, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/v1",
    maxAge: MEDIA_AUTH_COOKIE_TTL_SECONDS * 1000,
  })
}

export function setMediaAuthCookieFromAuthorization(response: Response, authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) return false
  const token = authorization.replace("Bearer ", "").trim()
  if (!token) return false
  setMediaAuthCookie(response, token)
  return true
}

export function clearMediaAuthCookie(response: Response) {
  response.clearCookie(MEDIA_AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/v1",
  })
}
