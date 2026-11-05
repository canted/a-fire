import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common"
import { Request } from "express"
import { AuthGuard, RequestWithUser } from "../auth/auth.guard"
import { RoundsService, type RoundInput, type RoundParticipationInput } from "./rounds.service"
import type {
  RoundArtifactInput,
  RoundChoiceInput,
  RoundRemovalInput,
} from "./runtime/round-runtime.types"

@Controller("api/v1")
@UseGuards(AuthGuard)
export class RoundsController {
  @Inject(RoundsService)
  private readonly activitiesService!: RoundsService

  @Get("rooms/:roomId/rounds/overview")
  async overviewForRoom(@Param("roomId") roomId: string, @Req() request: Request) {
    return this.activitiesService.overviewForRoom(Number(roomId), (request as RequestWithUser).user?.id ?? 0)
  }

  @Get("rooms/:roomId/participation")
  async participationForRoom(@Param("roomId") roomId: string, @Query("cursor") cursor: string | undefined, @Query("limit") limit: string | undefined, @Req() request: Request) {
    return this.activitiesService.participationForRoom(Number(roomId), (request as RequestWithUser).user?.id ?? 0, { cursor, limit: limit === undefined ? undefined : Number(limit) })
  }

  @Get("rooms/:roomId/history")
  async historyForRoom(@Param("roomId") roomId: string, @Query("cursor") cursor: string | undefined, @Query("limit") limit: string | undefined, @Req() request: Request) {
    return this.activitiesService.historyForRoom(Number(roomId), (request as RequestWithUser).user?.id ?? 0, { cursor, limit: limit === undefined ? undefined : Number(limit) })
  }

  @Get("rooms/:roomId/rounds")
  async listForRoom(@Param("roomId") roomId: string, @Req() request: Request) {
    return this.activitiesService.listForRoom(Number(roomId), (request as RequestWithUser).user?.id ?? 0)
  }

  @Post("rooms/:roomId/rounds")
  async createForRoom(@Param("roomId") roomId: string, @Body() body: RoundInput, @Req() request: Request) {
    return this.activitiesService.createForRoom(Number(roomId), (request as RequestWithUser).user?.id ?? 0, body ?? {})
  }

  @Get("rounds/:roundId")
  async show(@Param("roundId") roundId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.activitiesService.show(Number(roundId), userId)
  }

  @Patch("rounds/:roundId")
  async update(@Param("roundId") roundId: string, @Body() body: RoundInput, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.activitiesService.update(Number(roundId), userId, body ?? {})
  }

  @Post("rounds/:roundId/start")
  async start(@Param("roundId") roundId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.activitiesService.start(Number(roundId), userId)
  }

  @Post("rounds/:roundId/archive")
  async archive(@Param("roundId") roundId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.activitiesService.archive(Number(roundId), userId)
  }

  @Post("rounds/:roundId/reminders/phase")
  async remindForCurrentPhase(@Param("roundId") roundId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.activitiesService.remindForCurrentPhase(Number(roundId), userId)
  }

  @Post("rounds/:roundId/reminders/submission/:targetUserId")
  async remindParticipantToSubmit(
    @Param("roundId") roundId: string,
    @Param("targetUserId") targetUserId: string,
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.activitiesService.remindParticipantToSubmit(Number(roundId), Number(targetUserId), userId)
  }

  @Post("rounds/:roundId/participation")
  async updateParticipation(
    @Param("roundId") roundId: string,
    @Body() body: RoundParticipationInput,
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.activitiesService.updateParticipation(Number(roundId), userId, body ?? {})
  }

  @Delete("rounds/:roundId/participation")
  async withdrawParticipation(@Param("roundId") roundId: string, @Req() request: Request) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.activitiesService.withdrawParticipation(Number(roundId), userId)
  }

  @Post("rounds/:roundId/contributions/artifacts")
  async submitRoundArtifact(
    @Param("roundId") roundId: string,
    @Body() body: RoundArtifactInput,
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.activitiesService.submitRoundArtifact(Number(roundId), userId, body ?? {})
  }

  @Post("rounds/:roundId/contributions/choice")
  async chooseActivityOption(
    @Param("roundId") roundId: string,
    @Body() body: RoundChoiceInput,
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.activitiesService.chooseActivityOption(Number(roundId), userId, body ?? {})
  }

  @Delete("rounds/:roundId/contributions/artifacts/:artifactId")
  async removeRoundArtifact(
    @Param("roundId") roundId: string,
    @Param("artifactId") artifactId: string,
    @Body() body: RoundRemovalInput,
    @Req() request: Request,
  ) {
    const userId = (request as RequestWithUser).user?.id ?? 0
    return this.activitiesService.removeRoundArtifact(Number(roundId), userId, {
      ...(body ?? {}),
      artifactId,
    })
  }
}
