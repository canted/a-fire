import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnprocessableEntityException,
  UseGuards,
} from "@nestjs/common"
import type { Request, Response } from "express"
import { AuthService } from "./auth.service"
import { AuthGuard, RequestWithUser } from "./auth.guard"
import { clearMediaAuthCookie, setMediaAuthCookie, setMediaAuthCookieFromAuthorization } from "./media-auth-cookie"

@Controller("api/v1/auth")
export class AuthController {
  @Inject(AuthService)
  private readonly authService!: AuthService

  @Post("request_otp")
  async requestOtp(@Body() body: { email?: string }): Promise<void> {
    const email = body?.email?.toString() || ""
    if (!email) return
    if (process.env.NODE_ENV === "test") {
      // eslint-disable-next-line no-console
      console.info(`[OTP][request] email=${email} node_env=${process.env.NODE_ENV ?? "unknown"}`)
    }
    const { rateLimited } = await this.authService.requestOtp(email)
    if (rateLimited) {
      throw new HttpException("Too many requests. Please wait a moment and try again.", HttpStatus.TOO_MANY_REQUESTS)
    }
  }

  @Post("verify_otp")
  async verifyOtp(
    @Body() body: { email?: string; token?: string },
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ success: boolean; redirect: string | null; accessToken: string; refreshToken: string }> {
    const email = body?.email?.toString() || ""
    const token = body?.token?.toString() || ""
    if (!email || !token) {
      throw new UnprocessableEntityException("Invalid or expired code.")
    }

    const result = await this.authService.verifyOtp(email, token)
    const accessToken = this.authService.issueAccessToken(result.userId)
    const refreshToken = await this.authService.issueRefreshToken(result.userId)
    setMediaAuthCookie(response, accessToken)

    return { success: true, redirect: result.redirect, accessToken, refreshToken }
  }

  @Post("invites/accept")
  async acceptInvite(
    @Body() body: { token?: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ success: boolean; redirect: string; notice?: string | null; accessToken: string; refreshToken: string }> {
    const token = body?.token?.toString() || ""
    if (!token) {
      throw new UnprocessableEntityException("Invite not found.")
    }
    const result = await this.authService.acceptInvite(token, this.optionalAuthenticatedUserId(request))
    const accessToken = this.authService.issueAccessToken(result.userId)
    const refreshToken = await this.authService.issueRefreshToken(result.userId)
    setMediaAuthCookie(response, accessToken)
    return { success: result.success, redirect: result.redirect, notice: result.notice, accessToken, refreshToken }
  }

  @Post("refresh")
  async refresh(
    @Body() body: { refreshToken?: string },
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const refreshToken = body?.refreshToken?.toString() || ""
    if (!refreshToken) {
      clearMediaAuthCookie(response)
      throw new UnprocessableEntityException("Missing refresh token")
    }

    try {
      const result = await this.authService.rotateRefreshToken(refreshToken)
      setMediaAuthCookie(response, result.accessToken)
      return result
    } catch (error) {
      clearMediaAuthCookie(response)
      throw error
    }
  }

  @Post("media")
  @HttpCode(204)
  @UseGuards(AuthGuard)
  refreshMediaCookie(
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response,
  ): void {
    setMediaAuthCookieFromAuthorization(response, request.headers.authorization)
  }

  private optionalAuthenticatedUserId(request: Request): number | null {
    const authorization = request.headers.authorization
    if (!authorization?.startsWith("Bearer ")) return null

    try {
      return this.authService.verifyAccessToken(authorization.replace("Bearer ", "").trim()).userId
    } catch {
      return null
    }
  }
}
