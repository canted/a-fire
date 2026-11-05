import { Inject, Injectable } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"
import { RoundRuntime } from "./runtime/round-runtime.registry"
import type { Prisma } from "@prisma/client"
import { publishRoundWall } from "./publish-round-wall"
import { roomRoundScope, roundRoomId } from "./round-scope"
import { syncRoundChat } from "./round-chat"

/** Moves elapsed Activities out of the active slot before any surface presents them. */
@Injectable()
export class RoundLifecycleService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(RoundRuntime)
  private readonly rounds!: RoundRuntime

  async reconcileCircle(circleId: number, now = new Date()) {
    return this.reconcileScope(roomRoundScope(circleId), now)
  }

  private async reconcileScope(scope: Prisma.RoundWhereInput, now: Date) {
    const where: Prisma.RoundWhereInput = { ...scope, status: "active", feedback_due_at: { lte: now } }
    // Fix the run's upper boundary; new overdue Rounds are picked up by the next run.
    const last = await this.prisma.round.findFirst({ where, orderBy: { id: "desc" }, select: { id: true } })
    if (!last) return
    let after = 0
    for (;;) {
      const activities = await this.prisma.round.findMany({
        where: { ...where, id: { gt: after, lte: last.id } },
        orderBy: { id: "asc" }, take: 100,
        select: { id: true, template_key: true, feedback_due_at: true },
      })
      // Each completion owns its own transaction. Do not fan a backlog out into
      // the connection pool; failures leave unfinished rows eligible for replay.
      for (const activity of activities) await this.complete(activity, now)
      if (activities.length < 100) return
      after = activities[activities.length - 1].id
    }
  }

  async reconcileActivity(activityId: number, now = new Date()) {
    const activity = await this.prisma.round.findFirst({
      where: {
        id: Number(activityId),
        status: "active",
        feedback_due_at: { lte: now },
      },
      select: { id: true, template_key: true, feedback_due_at: true, room_id: true },
    })
    if (!activity) return false
    roundRoomId(activity)
    return this.complete(activity, now)
  }

  private async complete(
    activity: { id: number; template_key: string; feedback_due_at: Date | null },
    now: Date,
  ) {
    if (activity.template_key === "art_before_chorus") {
      await this.rounds.complete(activity.id, activity.template_key)
      return true
    }
    const completed = await this.prisma.$transaction(async tx => {
      // PostgreSQL preserves sub-millisecond precision and rechecks the current
      // deadline while acquiring the row lock. Never copy a stale JS Date back.
      // Stored timestamps use UTC without a zone; bind ISO text with an explicit
      // timestamp cast rather than allowing session-timezone conversion.
      const updated = await tx.$executeRaw`UPDATE rounds
        SET status = 'archived', closed_at = feedback_due_at, updated_at = ${now.toISOString()}::timestamp
        WHERE id = ${activity.id} AND status = 'active'
          AND activity_key = ${activity.template_key} AND feedback_due_at <= ${now.toISOString()}::timestamp`
      if (updated === 0) return false
      await publishRoundWall(tx, activity.id)
      await syncRoundChat(tx, activity.id, now)
      return true
    })
    return completed
  }
}
