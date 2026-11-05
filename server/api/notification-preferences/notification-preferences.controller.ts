import { BadRequestException, Body, Controller, Get, Inject, Patch, Req, UseGuards, UseInterceptors } from "@nestjs/common"
import type { Request } from "express"
import { AuthGuard, RequestWithUser } from "../v1/auth/auth.guard"
import { NotificationPreferencesService } from "../../notifications/notification-preferences.service"
import { LegacyApiDeprecationInterceptor } from "../legacy-api-deprecation.interceptor"

type UpdatePayload = {
  room_id?: string | number
  notification_type?: string
}

@Controller("api/notification_preferences")
@UseGuards(AuthGuard)
@UseInterceptors(new LegacyApiDeprecationInterceptor())
export class NotificationPreferencesController {
  @Inject(NotificationPreferencesService)
  private readonly notificationPreferences!: NotificationPreferencesService

  @Get()
  async index(@Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.notificationPreferences.listForUser(userId)
  }

  @Patch()
  async update(@Req() request: Request, @Body() payload: UpdatePayload) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    const roomId = Number(payload.room_id)
    if (!roomId || Number.isNaN(roomId)) {
      throw new BadRequestException("room_id is required")
    }

    return this.notificationPreferences.updateForUser(userId, roomId, payload.notification_type ?? "")
  }
}
