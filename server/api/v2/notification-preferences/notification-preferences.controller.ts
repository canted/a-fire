import { notificationTypeFromApi } from "../../notification-preferences/notification-preference-contract"
import { BadRequestException, Body, Controller, Get, Inject, Patch, Req, UseGuards } from "@nestjs/common"
import type { Request } from "express"
import { AuthGuard, RequestWithUser } from "../../v1/auth/auth.guard"
import { NotificationPreferencesService } from "../../../notifications/notification-preferences.service"
import { serializeNotificationPreferenceItem, serializeNotificationPreferences } from "../serializers"

type UpdatePayload = {
  room_id?: string | number
  notification_type?: string
}

@Controller("api/v2/notification-preferences")
@UseGuards(AuthGuard)
export class V2NotificationPreferencesController {
  @Inject(NotificationPreferencesService)
  private readonly notificationPreferences!: NotificationPreferencesService

  @Get()
  async index(@Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return serializeNotificationPreferences(await this.notificationPreferences.listForUser(userId))
  }

  @Patch()
  async update(@Req() request: Request, @Body() payload: UpdatePayload) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    const roomId = Number(payload.room_id)
    if (!roomId || Number.isNaN(roomId)) {
      throw new BadRequestException("room_id is required")
    }

    return serializeNotificationPreferenceItem(
      await this.notificationPreferences.updateForUser(userId, roomId, notificationTypeFromApi(payload.notification_type ?? "")),
    )
  }
}
