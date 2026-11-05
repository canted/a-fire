import { Controller, Get, Inject, Param, ParseIntPipe, Post, Query, Req, UseGuards } from "@nestjs/common"
import { AuthGuard, type RequestWithUser } from "../auth/auth.guard"
import { WallsService } from "./walls.service"

@Controller("api/v1")
@UseGuards(AuthGuard)
export class WallsController {
  @Inject(WallsService) private readonly walls!: WallsService

  @Get("rooms/:roomId/walls")
  list(@Param("roomId", ParseIntPipe) roomId: number, @Query("cursor") cursor: string | undefined, @Req() request: RequestWithUser) {
    return this.walls.list(Number(roomId), request.user?.id ?? 0, cursor)
  }
  @Get("walls/:wallId")
  show(@Param("wallId", ParseIntPipe) wallId: number, @Req() request: RequestWithUser) {
    return this.walls.show(Number(wallId), request.user?.id ?? 0)
  }
  @Post("walls/:wallId/presentation")
  present(@Param("wallId", ParseIntPipe) wallId: number, @Req() request: RequestWithUser) {
    return this.walls.present(Number(wallId), request.user?.id ?? 0)
  }
}
