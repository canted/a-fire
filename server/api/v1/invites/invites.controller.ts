import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common"
import type { Request } from "express"
import { AuthGuard, RequestWithUser } from "../auth/auth.guard"
import { InvitesService } from "./invites.service"
import { InviteIndexResponse, InvitePayload, InviteStatus, InviteSuggestionsResponse, InviteType } from "./invites.types"

type InviteCreateBody = {
  invite: {
    email?: string
    invitee_membership_id?: number
    invite_type?: InviteType
    room_id?: number | null
  }
}

@Controller("api/v1/invites")
@UseGuards(AuthGuard)
export class InvitesController {
  @Inject(InvitesService)
  private readonly invitesService!: InvitesService

  @Get("suggestions")
  async suggestions(
    @Query("room_id") roomId?: string,
    @Query("q") query?: string,
    @Req() request?: Request,
  ): Promise<InviteSuggestionsResponse> {
    const userId = (request as RequestWithUser | undefined)?.user?.id ?? 0
    return this.invitesService.listInviteSuggestions(userId, {
      roomId: roomId ? Number(roomId) : undefined,
      query,
    })
  }

  @Get()
  async index(
    @Query("room_id") roomId?: string,
    @Query("status") status?: InviteStatus,
    @Query("search") search?: string,
    @Req() request?: Request,
  ): Promise<InviteIndexResponse> {
    const userId = (request as RequestWithUser | undefined)?.user?.id ?? 0
    return this.invitesService.listInvites(userId, {
      roomId: roomId ? Number(roomId) : undefined,
      status,
      search,
    })
  }

  @Post()
  async create(@Body() body: InviteCreateBody, @Req() request?: Request): Promise<InvitePayload> {
    const userId = (request as RequestWithUser | undefined)?.user?.id ?? 0
    return this.invitesService.createInvite(userId, {
      email: body.invite?.email,
      invitee_membership_id: body.invite?.invitee_membership_id,
      invite_type: body.invite?.invite_type,
      room_id: body.invite?.room_id,
    })
  }

  @Post(":id/expire")
  async expire(@Param("id") id: string, @Req() request?: Request): Promise<InvitePayload> {
    const userId = (request as RequestWithUser | undefined)?.user?.id ?? 0
    return this.invitesService.expireInvite(userId, Number(id))
  }

  @Post(":id/resend")
  async resend(@Param("id") id: string, @Req() request?: Request): Promise<InvitePayload> {
    const userId = (request as RequestWithUser | undefined)?.user?.id ?? 0
    return this.invitesService.resendInvite(userId, Number(id))
  }
}
