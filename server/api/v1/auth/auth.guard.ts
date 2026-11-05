import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { NotificationActivityService } from "../../../notifications/notification-activity.service";
import { AuthService } from "./auth.service";

export type RequestWithUser = Request & { user?: { id: number }; sessionId?: string };
/** Controller request after AuthGuard or MediaAuthGuard has authenticated it. */
export type AuthenticatedRequest = RequestWithUser & { user: { id: number } };

@Injectable()
export class AuthGuard implements CanActivate {
  @Inject(AuthService)
  private readonly authService!: AuthService

  @Inject(NotificationActivityService)
  private readonly notificationActivity!: NotificationActivityService

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.headers.authorization;
    if (header && header.startsWith("Bearer ")) {
      const token = header.replace("Bearer ", "").trim();
      const { userId, sessionId } = this.authService.verifyAccessToken(token);
      request.user = { id: userId };
      if (sessionId) request.sessionId = sessionId;
      this.recordActivity(userId);
      return true;
    }

    throw new UnauthorizedException("Unauthorized");
  }

  private recordActivity(userId: number) {
    void this.notificationActivity.recordActivity(userId).catch((error) => {
      console.error(
        JSON.stringify({
          event: "notification_activity_error",
          user_id: userId,
          message: error instanceof Error ? error.message : String(error),
        }),
      )
    })
  }
}
