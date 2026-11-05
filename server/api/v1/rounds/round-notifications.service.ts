import { completedFeedbackUsers } from "./completed-feedback-users"
import { roundPath } from "../../../../types/round-links"
import type { Prisma } from "@prisma/client"
import { BadRequestException, Inject, Injectable } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"
import { BossService } from "../../../queue/boss.service"
import { ACTIVITY_NOTIFICATION_QUEUE } from "../../../queue/queue-names"
import type { RoundNotificationJob, RoundNotificationMilestone } from "./rounds.types"
import { RoundRuntime } from "./runtime/round-runtime.registry"
import { RoundLifecycleService } from "./round-lifecycle.service"

const ACTIVITY_DEADLINE_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000

/** Schedules and delivers Activity milestones and participant reminders. */
@Injectable()
export class RoundNotificationsService {
  @Inject(RoundRuntime)
  private readonly rounds!: RoundRuntime

  @Inject(RoundLifecycleService)
  private readonly lifecycle!: RoundLifecycleService
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(BossService)
  private readonly boss!: BossService

  async handleScheduledNotification(job: RoundNotificationJob) {
    if (!Number.isInteger(job.roundId) || !this.isNotificationMilestone(job.milestone)) return
    const activity = await this.prisma.round.findUnique({ where: { id: job.roundId } })
    if (!activity || !activity.room_id) return
    // A previous attempt may have committed completion before delivery failed.
    if (activity.status !== "active" && !(activity.status === "archived" && job.milestone === "round_completed")) return

    const expectedAt = new Date(job.expectedAt)
    const actualAt = this.notificationMilestoneDate(activity, job.milestone)
    if (
      Number.isNaN(expectedAt.getTime()) ||
      !actualAt ||
      actualAt.getTime() !== expectedAt.getTime()
    ) {
      return
    }

    const dueAt = this.notificationJobDueAt(job.milestone, actualAt)
    if (Date.now() + 1_000 < dueAt.getTime()) return

    await this.lifecycle.reconcileActivity(activity.id)
    await this.rounds.syncChat(activity.id)

    const targetUserIds = await this.notificationTargets(activity, job.milestone)
    if (targetUserIds.length === 0) return

    const eventType = job.milestone.includes("deadline") ? "round_deadline_approaching" : "round_phase_changed"
    const excerpt = this.notificationExcerpt(activity.name, job.milestone, activity.template_key)
    await Promise.all(
      targetUserIds.map(async (targetUserId) => {
        const notificationKey = this.notificationKey(activity.id, job.milestone, job.expectedAt, targetUserId)
        await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${notificationKey}, 0))`
        const existing = await tx.notificationEvent.findFirst({
          where: {
            target_user_id: targetUserId,
            payload: {
              path: ["round_notification_key"],
              equals: notificationKey,
            },
          },
          select: { id: true },
        })
        if (existing) return

        const now = new Date()
        const event = await tx.notificationEvent.create({
          data: {
            event_type: eventType,
            actor_id: activity.host_id,
            room_id: Number(activity.room_id ?? 0),
            target_user_id: targetUserId,
            payload: {
              round_id: String(activity.id),
              activity_name: activity.name,
              milestone: job.milestone,
              excerpt,
              include_actor: true,
              round_notification_key: notificationKey,
            },
            target_path: roundPath(activity.id),
            created_at: now,
            updated_at: now,
          },
        })
        await this.boss.enqueueInTransaction(tx, "notifications.fanout", { eventId: event.id })
        })
      }),
    )
  }

  async scheduleActiveActivityNotifications() {
    const activities = await this.prisma.round.findMany({
      where: { status: "active" },
      select: {
        id: true,
        status: true,
        started_at: true,
        submit_by: true,
        feedback_due_at: true,
      },
    })
    await Promise.all(activities.map(async (activity) => {
      // Catch up after worker downtime before rebuilding future jobs.
      if (await this.lifecycle.reconcileActivity(activity.id)) return
      await this.scheduleActivityNotifications(activity)
    }))
  }

  async enqueueReminder(
    activity: {
      id: number
      room_id: number | null
      name: string
      template_key?: string | null
    },
    actorId: number,
    targetUserId: number,
    phase: "submission" | "feedback",
  ) {
    if (!activity.room_id) throw new BadRequestException("Activity reminders require a circle")
    const now = new Date()
    const excerpt = activity.template_key === "art_before_chorus"
      ? phase === "submission"
        ? `Please add some cover art to ${activity.name}.`
        : `Please choose a cover and add your response to ${activity.name}.`
      : `Please ${phase === "submission" ? "post to" : "give feedback in"} ${activity.name}.`
    await this.prisma.$transaction(async tx => {
    const event = await tx.notificationEvent.create({
      data: {
        event_type: "round_reminder",
        actor_id: actorId,
        room_id: Number(activity.room_id ?? 0),
        target_user_id: targetUserId,
        payload: {
          round_id: String(activity.id),
          activity_name: activity.name,
          phase,
          excerpt,
        },
        target_path: roundPath(activity.id),
        created_at: now,
        updated_at: now,
      },
    })
    await this.boss.enqueueInTransaction(tx, "notifications.fanout", { eventId: event.id })
    })
  }

  async scheduleActivityNotifications(activity: {
    id: number
    status: string
    started_at?: Date | null
    submit_by?: Date | null
    feedback_due_at?: Date | null
  }, transaction?: Prisma.TransactionClient): Promise<void> {
    if (!transaction) await this.rounds.syncChat(activity.id)
    if (activity.status !== "active") return
    if (!transaction) return this.prisma.$transaction(tx => this.scheduleActivityNotifications(activity, tx))
    const now = new Date()
    const jobs: Array<{ milestone: RoundNotificationMilestone; at: Date | null | undefined }> = [
      { milestone: "submission_started", at: activity.started_at },
      { milestone: "submission_deadline_soon", at: activity.submit_by },
      { milestone: "feedback_started", at: activity.submit_by },
      { milestone: "feedback_deadline_soon", at: activity.feedback_due_at },
      { milestone: "round_completed", at: activity.feedback_due_at },
    ]

    await Promise.all(
      jobs.map(async ({ milestone, at }) => {
        if (!at) return
        const dueAt = this.notificationJobDueAt(milestone, at)
        if (milestone === "submission_started") {
          if (at.getTime() < now.getTime() - 60_000) return
        } else if (at.getTime() <= now.getTime()) {
          return
        }
        const scheduledAt = dueAt < now ? now : dueAt
        const expectedAt = at.toISOString()
        // Keep persisted job identity stable so pending work is not duplicated during the API rename.
        const data = { activityId: activity.id, milestone, expectedAt }
        const key = `activity-${activity.id}-${milestone}-${expectedAt}`
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
        if (!await this.boss.hasOutstandingJob(transaction, ACTIVITY_NOTIFICATION_QUEUE, data)) {
          await this.boss.enqueueInTransaction(transaction, ACTIVITY_NOTIFICATION_QUEUE, data, { startAfter: scheduledAt })
        }
      }),
    )
  }

  private notificationJobDueAt(milestone: RoundNotificationMilestone, milestoneAt: Date) {
    return milestone.includes("deadline")
      ? new Date(milestoneAt.getTime() - ACTIVITY_DEADLINE_REMINDER_LEAD_MS)
      : milestoneAt
  }

  private notificationMilestoneDate(
    activity: { started_at?: Date | null; submit_by?: Date | null; feedback_due_at?: Date | null },
    milestone: RoundNotificationMilestone,
  ) {
    if (milestone === "submission_started") return activity.started_at
    if (milestone === "submission_deadline_soon" || milestone === "feedback_started") return activity.submit_by
    return activity.feedback_due_at
  }

  private async notificationTargets(
    activity: { id: number; template_key?: string | null },
    milestone: RoundNotificationMilestone,
  ) {
    const participations = await this.prisma.activityParticipation.findMany({
      where: { round_id: activity.id, status: "active" },
      select: { user_id: true, role: true, submitted_entry_id: true },
    })
    if (
      activity.template_key === "art_before_chorus" &&
      (milestone === "submission_deadline_soon" || milestone === "feedback_deadline_soon")
    ) {
      const artifacts = await this.prisma.activityArtifact.findMany({
        where: {
          round_id: activity.id,
          kind: milestone === "submission_deadline_soon" ? "cover" : "response",
          status: "active",
        },
        select: { user_id: true },
      })
      const completedUserIds = new Set(artifacts.map((artifact) => Number(artifact.user_id)))
      return participations
        .filter((participation) => participation.role === "participant")
        .map((participation) => Number(participation.user_id ?? 0))
        .filter((targetUserId) => !completedUserIds.has(targetUserId))
    }
    if (milestone === "submission_deadline_soon") {
      return participations
        .filter((participation) => participation.role === "participant" && !participation.submitted_entry_id)
        .map((participation) => Number(participation.user_id ?? 0))
    }
    if (milestone !== "feedback_deadline_soon") {
      return [...new Set(participations.map((participation) => Number(participation.user_id ?? 0)))]
    }

    const eligible = participations.filter((participation) =>
      ["participant", "reviewer"].includes(participation.role),
    )
    const postIds = participations
      .map((participation) => Number(participation.submitted_entry_id ?? 0))
      .filter((postId) => postId > 0)
    if (postIds.length === 0) return []
    const completedUserIds = await completedFeedbackUsers(
      this.prisma, postIds, eligible.map(participation => participation.user_id),
    )
    return eligible
      .map((participation) => Number(participation.user_id ?? 0))
      .filter((targetUserId) => !completedUserIds.has(targetUserId))
  }

  private notificationExcerpt(activityName: string, milestone: RoundNotificationMilestone, templateKey?: string | null) {
    if (templateKey === "art_before_chorus") {
      if (milestone === "submission_started") return `${activityName} is open for cover art.`
      if (milestone === "submission_deadline_soon") return `Cover art for ${activityName} is due in about 24 hours.`
      if (milestone === "feedback_started") return `Choose a cover and make your response for ${activityName}.`
      if (milestone === "feedback_deadline_soon") return `Responses for ${activityName} are due in about 24 hours.`
      return `Open ${activityName} to see the results.`
    }
    if (milestone === "submission_started") return `Submissions are open for ${activityName}.`
    if (milestone === "submission_deadline_soon") {
      return `The submission deadline for ${activityName} is in about 24 hours.`
    }
    if (milestone === "feedback_started") return `Feedback is now open for ${activityName}.`
    if (milestone === "feedback_deadline_soon") {
      return `The feedback deadline for ${activityName} is in about 24 hours.`
    }
    return `Open ${activityName} to see the results.`
  }

  private notificationKey(
    activityId: number,
    milestone: RoundNotificationMilestone,
    expectedAt: string,
    targetUserId: number,
  ) {
    return `round:${activityId}:${milestone}:${expectedAt}:user:${targetUserId}`
  }

  private isNotificationMilestone(value: unknown): value is RoundNotificationMilestone {
    return [
      "submission_started",
      "submission_deadline_soon",
      "feedback_started",
      "feedback_deadline_soon",
      "round_completed",
    ].includes(String(value))
  }
}
