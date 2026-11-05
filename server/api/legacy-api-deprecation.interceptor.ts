import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from "@nestjs/common"
import type { Request, Response } from "express"
import type { Observable } from "rxjs"

const SUNSET = "Tue, 15 Sep 2026 00:00:00 GMT"

type RequestWithMaybeUser = Request & {
  user?: { id?: number | string | null } | null
}

@Injectable()
export class LegacyApiDeprecationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp()
    const request = http.getRequest<RequestWithMaybeUser>()
    const response = http.getResponse<Response>()
    const originalUrl = request.originalUrl || request.url || ""
    const replacement = successorPath(originalUrl)

    response.setHeader("Deprecation", "true")
    response.setHeader("Sunset", SUNSET)
    if (replacement) {
      response.setHeader("Link", `<${replacement}>; rel="successor-version"`)
    }

    console.warn(
      JSON.stringify({
        event: "legacy_api_route_used",
        route: originalUrl,
        user_id: request.user?.id ?? null,
        replacement,
      }),
    )

    return next.handle()
  }
}

export function successorPath(originalUrl: string): string | null {
  const url = new URL(originalUrl, "http://localhost")
  let pathname = url.pathname

  if (pathname.startsWith("/api/v1/pages")) {
    pathname = pathname.replace(/^\/api\/v1\/pages/, "/api/v2/notes")
    const communityId = url.searchParams.get("room_id")
    if (communityId !== null) {
      url.searchParams.delete("room_id")
      url.searchParams.set("room_id", communityId)
    }
    return `${pathname}${url.search}`
  }

  if (pathname.startsWith("/api/v1/rooms")) {
    pathname = pathname.replace(/^\/api\/v1\/rooms/, "/api/v2/rooms")
    return `${pathname}${url.search}`
  }

  if (pathname === "/api/profile/avatar") return "/api/v2/profile/avatar"
  if (pathname === "/api/notification_preferences") return "/api/v2/notification-preferences"
  if (pathname === "/api/push_subscriptions/unsubscribe") return "/api/v2/push-subscriptions/unsubscribe"
  if (pathname === "/api/push_subscriptions") return "/api/v2/push-subscriptions"

  return null
}
