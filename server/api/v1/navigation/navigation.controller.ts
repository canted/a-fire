import { Controller, Get, Inject, Query, Req, UseGuards } from "@nestjs/common"
import { Request } from "express"
import { AuthGuard, RequestWithUser } from "../auth/auth.guard"
import { NavigationService } from "./navigation.service"

@Controller("api/v1/navigation")
@UseGuards(AuthGuard)
export class NavigationController {
  @Inject(NavigationService)
  private readonly navigationService!: NavigationService

  @Get("slide_menu")
  async slideMenu(@Query("currentRoomId") currentRoomId: string | undefined, @Query("current_room_id") legacyId: string | undefined, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id
    const resolved = currentRoomId ?? legacyId
    const parsed = resolved ? Number(resolved) : undefined
    return this.navigationService.slideMenu(userId ?? 0, parsed)
  }
}
