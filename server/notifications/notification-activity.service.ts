import { Inject, Injectable } from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service"

type RecordActivityOptions = {
  cancelScheduledPushes?: boolean
  throttleMs?: number
}

const DEFAULT_ACTIVITY_THROTTLE_MS = 60_000

@Injectable()
export class NotificationActivityService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  private readonly lastRecordedActivityByUser = new Map<number, number>()

  async recordActivity(userId: number, occurredAt = new Date(), options: RecordActivityOptions = {}): Promise<void> {
    const cancelScheduledPushes = options.cancelScheduledPushes ?? true
    const throttleMs = options.throttleMs ?? DEFAULT_ACTIVITY_THROTTLE_MS
    const occurredAtMs = occurredAt.getTime()
    const previousActivityMs = this.lastRecordedActivityByUser.get(userId)
    if (previousActivityMs !== undefined && occurredAtMs - previousActivityMs < throttleMs) {
      return
    }
    this.lastRecordedActivityByUser.set(userId, occurredAtMs)

    await this.prisma.user.update({
      where: { id: userId },
      data: { last_seen_at: occurredAt },
    })

    if (!cancelScheduledPushes) return

    await this.prisma.notificationPushDelivery.updateMany({
      where: {
        user_id: userId,
        state: "scheduled",
        notification_event: {
          created_at: { lte: occurredAt },
        },
      },
      data: {
        state: "cancelled",
        cancelled_at: occurredAt,
        skip_reason: "user_activity",
        updated_at: occurredAt,
      },
    })
  }
}
