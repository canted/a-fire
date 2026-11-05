import { withActiveRoomTransaction } from "../api/v1/rooms/room-membership-transaction"
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { PrismaService } from "../prisma/prisma.service"
import { captureNotificationPreferencesUpdated } from "../runtime/posthog"
import { circleIconUrl } from "../api/v1/uploads/upload-urls"

export const NOTIFICATION_TYPES = ["all", "posts", "none"] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export const DELIVERY_MODES = ["immediate", "mute"] as const
export type DeliveryMode = (typeof DELIVERY_MODES)[number]

export type EffectivePreference = {
  notificationType: NotificationType
  deliveryMode: DeliveryMode
  pushEnabled: boolean
}

type NotificationEventWithRelations = Prisma.NotificationEventGetPayload<{
  include: { actor: true; room: true }
}>

const DEFAULTS: EffectivePreference = {
  notificationType: "all",
  deliveryMode: "immediate",
  pushEnabled: true,
}

const RESOLUTION_ORDER: Array<{ scopeType: string; getId: (event: NotificationEventWithRelations) => number | null }> = [
  { scopeType: "Post", getId: (event) => (event.entry_id ? Number(event.entry_id) : null) },
  { scopeType: "Circle", getId: (event) => (event.room_id ? Number(event.room_id) : null) },
  { scopeType: "Global", getId: () => null },
]

@Injectable()
export class NotificationPreferencesService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  async listForUser(userId: number) {
    const memberships = await this.prisma.roomMembership.findMany({
      where: { user_id: userId, disabled: false, room: { deleted_at: null } },
      include: { room: true },
    })

    const communityIds = memberships.map((membership) => Number(membership.room_id))
    if (communityIds.length === 0) return { items: [] }

    const preferences = await this.prisma.notificationPreference.findMany({
      where: {
        user_id: userId,
        scope_type: "Circle",
        scope_id: { in: communityIds.map((id) => Number(id)) },
      },
    })

    const preferenceMap = new Map<number, typeof preferences[number]>()
    preferences.forEach((preference) => preferenceMap.set(Number(preference.scope_id), preference))

    const avatarMap = await this.communityAvatarMap(communityIds)

    return {
      items: memberships.map((membership) => {
        const community = membership.room
        const preference = preferenceMap.get(Number(community.id))
        return {
          room_id: Number(community.id),
          room_name: community.name,
          room_avatar_url: avatarMap.get(Number(community.id)) ?? null,
          notification_type: preference?.notification_type ?? DEFAULTS.notificationType,
        }
      }),
    }
  }

  async updateForUser(userId: number, communityId: number, notificationType: string) {
    if (!this.isValidNotificationType(notificationType)) {
      throw new BadRequestException("Invalid notification type")
    }

    const { membership, preference } = await withActiveRoomTransaction(this.prisma, communityId, async transaction => {
      const membership = await transaction.roomMembership.findFirst({
        where: { user_id: userId, room_id: communityId, disabled: false },
        include: { room: true },
      })
      if (!membership) throw new NotFoundException("Not Found")

      const existing = await transaction.notificationPreference.findFirst({
        where: { user_id: userId, scope_type: "Circle", scope_id: Number(communityId) },
      })

      const now = new Date()
      const preference = existing
        ? await transaction.notificationPreference.update({
            where: { id: existing.id },
            data: {
              notification_type: notificationType,
              updated_at: now,
            },
          })
        : await transaction.notificationPreference.create({
            data: {
              user_id: userId,
              scope_type: "Circle",
              scope_id: Number(communityId),
              notification_type: notificationType,
              delivery_mode: DEFAULTS.deliveryMode,
              push_enabled: DEFAULTS.pushEnabled,
              created_at: now,
              updated_at: now,
            },
          })
      return { membership, preference }
    })

    const avatarMap = await this.communityAvatarMap([communityId])
    captureNotificationPreferencesUpdated({ userId, roomId: communityId, notificationType })
    return {
      room_id: Number(membership.room.id),
      room_name: membership.room.name,
      room_avatar_url: avatarMap.get(communityId) ?? null,
      notification_type: preference.notification_type,
    }
  }

  async resolveForUser(userId: number, event: NotificationEventWithRelations): Promise<EffectivePreference> {
    const scopes = RESOLUTION_ORDER.flatMap(entry => {
      const scopeId = entry.getId(event)
      return entry.scopeType !== "Global" && scopeId === null
        ? []
        : [{ scope_type: entry.scopeType, scope_id: scopeId }]
    })
    // Database uniqueness bounds this to one record per scope, including Global.
    const preferences = await this.prisma.notificationPreference.findMany({
      where: { user_id: userId, OR: scopes },
      select: { scope_type: true, scope_id: true, notification_type: true, delivery_mode: true, push_enabled: true },
      take: scopes.length,
    })
    for (const scope of scopes) {
      const preference = preferences.find(row => row.scope_type === scope.scope_type && row.scope_id === scope.scope_id)

      if (preference) {
        return {
          notificationType: (preference.notification_type as NotificationType) ?? DEFAULTS.notificationType,
          deliveryMode: (preference.delivery_mode as DeliveryMode) ?? DEFAULTS.deliveryMode,
          pushEnabled: preference.push_enabled ?? DEFAULTS.pushEnabled,
        }
      }
    }

    return { ...DEFAULTS }
  }

  allowsEvent(preference: EffectivePreference, eventType: string): boolean {
    if (preference.deliveryMode === "mute") return false

    if (preference.notificationType === "none") return false
    if (preference.notificationType === "posts") {
      return eventType === "post_created" || eventType === "mention" || eventType === "chat_message_saved_as_post"
    }
    return true
  }

  private isValidNotificationType(value: string): value is NotificationType {
    return (NOTIFICATION_TYPES as readonly string[]).includes(value)
  }

  private async communityAvatarMap(communityIds: number[]) {
    if (communityIds.length === 0) return new Map<number, string>()
    const attachments = await this.prisma.activeStorageAttachment.findMany({
      where: { record_type: "Circle", record_id: { in: communityIds.map((id) => Number(id)) }, name: "avatar" },
      select: { record_id: true, blob_id: true },
    })

    const map = new Map<number, string>()
    attachments.forEach((attachment) => {
      const url = circleIconUrl(`/api/v1/uploads/${String(attachment.blob_id)}`)
      if (url) map.set(Number(attachment.record_id), url)
    })

    return map
  }
}
