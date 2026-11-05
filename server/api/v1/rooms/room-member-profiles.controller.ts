import { Controller, Get, Inject, Param, ParseIntPipe, Query, Req, UseGuards } from "@nestjs/common"
import type { Request } from "express"
import { AuthGuard, type RequestWithUser } from "../auth/auth.guard"
import { RoomMemberProfilesService } from "./room-member-profiles.service"

/** Room/member identity is canonical; historical Square routes remain adapters. */
@Controller("api/v1/rooms/:roomId/members/:memberUserId")
@UseGuards(AuthGuard)
export class RoomMemberProfilesController {
  @Inject(RoomMemberProfilesService)
  private readonly profiles!: RoomMemberProfilesService

  @Get("entries")
  posts(@Param("roomId", ParseIntPipe) roomId: number, @Param("memberUserId", ParseIntPipe) memberUserId: number, @Query("page") page: string | undefined, @Query("cursor") cursor: string | undefined, @Req() request: Request) {
    const parsedPage = Number(page ?? 1)
    return this.profiles.fetchRoomMemberPosts(Number(roomId), Number(memberUserId), (request as RequestWithUser).user?.id ?? 0, Number.isFinite(parsedPage) ? parsedPage : 1, cursor)
  }

  @Get("introductions")
  introductions(@Param("roomId", ParseIntPipe) roomId: number, @Param("memberUserId", ParseIntPipe) memberUserId: number, @Query("cursor") cursor: string | undefined, @Query("introduction") target: string | undefined, @Req() request: Request) {
    return this.profiles.fetchRoomMemberIntroductions(Number(roomId), Number(memberUserId), (request as RequestWithUser).user?.id ?? 0, { cursor, target })
  }
}
