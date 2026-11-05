import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common"
import { MEDIA_AUTH_COOKIE_NAME } from "./media-auth-cookie"
import { AuthService } from "./auth.service"
import type { RequestWithUser } from "./auth.guard"

@Injectable()
export class MediaAuthGuard implements CanActivate {
  @Inject(AuthService)
  private readonly authService!: AuthService

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>()
    const token = bearerToken(request.headers.authorization) ?? cookieToken(request.headers.cookie)
    if (!token) throw new UnauthorizedException("Unauthorized")

    const { userId, sessionId } = this.authService.verifyAccessToken(token)
    request.user = { id: userId }
    if (sessionId) request.sessionId = sessionId
    return true
  }
}

function bearerToken(header: string | undefined) {
  if (!header?.startsWith("Bearer ")) return null
  const token = header.replace("Bearer ", "").trim()
  return token || null
}

function cookieToken(header: string | undefined) {
  if (!header) return null
  const cookies = header.split(";")
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.trim().split("=")
    if (name !== MEDIA_AUTH_COOKIE_NAME) continue
    const value = valueParts.join("=")
    return value ? decodeURIComponent(value) : null
  }
  return null
}
