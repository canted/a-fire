import { Inject, Injectable } from "@nestjs/common"
import { PrismaService } from "../../prisma/prisma.service"
import { capturePushSubscriptionDisabled, capturePushSubscriptionEnabled } from "../../runtime/posthog"

@Injectable()
export class PushSubscriptionsService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  async upsertSubscription(userId: number, endpoint: string, p256dh: string, auth: string): Promise<void> {
    const existing = await this.prisma.pushSubscription.findFirst({
      where: { user_id: Number(userId), endpoint },
    })

    const now = new Date()
    if (existing) {
      await this.prisma.pushSubscription.update({
        where: { id: existing.id },
        data: {
          p256dh,
          auth,
          subscribed: true,
          updated_at: now,
        },
      })
      capturePushSubscriptionEnabled({ userId })
      return
    }

    await this.prisma.pushSubscription.create({
      data: {
        user_id: Number(userId),
        endpoint,
        p256dh,
        auth,
        subscribed: true,
        created_at: now,
        updated_at: now,
      },
    })
    capturePushSubscriptionEnabled({ userId })
  }

  async unsubscribe(userId: number, endpoint?: string): Promise<void> {
    const where = endpoint
      ? { user_id: Number(userId), endpoint }
      : { user_id: Number(userId) }

    await this.prisma.pushSubscription.updateMany({
      where,
      data: { subscribed: false, updated_at: new Date() },
    })
    capturePushSubscriptionDisabled({ userId })
  }
}
