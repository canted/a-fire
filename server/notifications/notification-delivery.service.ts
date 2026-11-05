import { beginPushDeviceAttempt, completePushDeviceAttempt, pushDeviceFailureState } from "./push-device-journal"
import { canReadContentNotice } from "./notification-access";
import { RoomAccessService } from "../api/v1/rooms/room-access.service";
import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import webpush from "web-push";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import { NotificationPreferencesService, type EffectivePreference } from "./notification-preferences.service";
import { UnseenContentService } from "../api/v1/unseen/unseen-content.service";
import { readCompleteVapidConfigs, readVapidConfig } from "../runtime/vapid";
import { NotificationInboxSerializer } from "./notification-inbox.serializer";

type NotificationEventWithRelations = Prisma.NotificationEventGetPayload<{
  include: { actor: true; room: true };
}>;

type PushSchedule = {
  deliveryId: number;
  dueAt: Date;
};

export const NOTIFICATION_DELAYED_PUSH_QUEUE = "notifications.push.delayed";
const RECENT_ACTIVITY_WINDOW_MS = 2 * 60 * 1000;
const PUSH_SOCKET_TIMEOUT_MS = 10_000;

@Injectable()
export class NotificationDeliveryService {
  @Inject(NotificationPreferencesService)
  private readonly preferences!: NotificationPreferencesService;

  @Inject(PrismaService)
  private readonly prisma!: PrismaService;

  @Inject(RealtimeService)
  private readonly realtime!: RealtimeService;

  @Inject(UnseenContentService)
  private readonly unseenContent!: UnseenContentService;

  @Inject(NotificationInboxSerializer)
  private readonly inboxSerializer!: NotificationInboxSerializer;

  @Inject(RoomAccessService)
  private readonly circleAccess!: RoomAccessService;

  async deliverImmediately(userId: number, event: NotificationEventWithRelations, preference: EffectivePreference) {
    if (!(await canReadContentNotice(this.circleAccess, this.prisma, userId, event))) return { inboxItem: null, scheduledPushDelivery: undefined };
    const now = new Date();
    const inboxItem = await this.prisma.notificationInboxItem.upsert({
      where: { notification_event_id_user_id: { notification_event_id: event.id, user_id: userId } },
      create: {
        user_id: userId,
        notification_event_id: event.id,
        delivery_state: "delivered",
        delivered_at: now,
        created_at: now,
        updated_at: now,
      },
      update: {
        delivery_state: "delivered",
        delivered_at: now,
        updated_at: now,
      },
    });

    const unseenCount = await this.unseenContent.countForUser(userId);

    const [notice] = await this.inboxSerializer.serialize([
      {
        ...inboxItem,
        notification_event: event,
      },
    ]);

    if (!notice) return { inboxItem, scheduledPushDelivery: undefined };

    this.realtime.emit("NotificationChannel", this.realtime.notificationRoom(userId), {
      type: "new_notification",
      inbox_item_id: String(inboxItem.id),
      unseen_count: unseenCount.total,
      unseen_counts: unseenCount,
      event_type: event.event_type,
      entry_id: event.entry_id,
      target_path: event.target_path,
      notice,
    });

    const scheduledPushDelivery = preference.pushEnabled
      ? await this.preparePushDelivery(userId, event, inboxItem.id)
      : undefined;

    return { inboxItem, scheduledPushDelivery };
  }

  async handleDelayedPush(deliveryId: number) {
    const delivery = await this.prisma.notificationPushDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        notification_event: { include: { actor: true, room: true } },
      },
    });

    if (!delivery || delivery.state !== "scheduled") return;
    const claim = await this.prisma.notificationPushDelivery.updateMany({
      where: { id: delivery.id, state: "scheduled" },
      data: { state: "sending", updated_at: new Date() },
    });
    if (claim.count !== 1) return;
    let externalAttempted = false;
    try {
      if (this.realtime.isUserActive(delivery.user_id)) {
        await this.markPushDelivery(delivery.id, {
          state: "cancelled",
          cancelled_at: new Date(),
          skip_reason: "user_active",
        });
        return;
      }

      const preference = await this.preferences.resolveForUser(delivery.user_id, delivery.notification_event);
      if (!preference.pushEnabled || !this.preferences.allowsEvent(preference, delivery.notification_event.event_type)) {
        await this.markPushDelivery(delivery.id, {
          state: "cancelled",
          cancelled_at: new Date(),
          skip_reason: "preferences_changed",
        });
        return;
      }

      const unseenCount = await this.unseenContent.countForUser(delivery.user_id);
      await this.sendPush(delivery.user_id, delivery.notification_event, unseenCount.total, delivery.id, {
        ignoreRecentActivity: true,
        onExternalAttempt: () => { externalAttempted = true; },
      });
    } catch (error) {
      // Preparation failures are safe to retry. Once a send may have happened,
      // retain the claim: blindly retrying could duplicate an external effect.
      if (!externalAttempted) await this.prisma.notificationPushDelivery.updateMany({
        where: { id: delivery.id, state: "sending" },
        data: { state: "scheduled", updated_at: new Date() },
      });
      throw error;
    }
  }

  private async preparePushDelivery(
    userId: number,
    event: NotificationEventWithRelations,
    inboxItemId: number,
  ): Promise<PushSchedule | undefined> {
    const now = new Date();
    const activity = await this.userActivityStatus(userId);
    const dueAt = activity.isActive ? this.nextPushDueAt(activity, now) : now;
    const delivery = await this.findOrCreatePushDelivery(userId, event.id, inboxItemId, dueAt, now);

    if (delivery.state !== "scheduled") return undefined;

    if (delivery.scheduled_job_id) return undefined;

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "push_delay_scheduled",
        user_id: userId,
        event_id: String(event.id),
        delivery_id: delivery.id,
        due_at: dueAt.toISOString(),
        realtime_active: activity.realtimeActive,
        last_seen_at: activity.lastSeenAt ? activity.lastSeenAt.toISOString() : null,
      }),
    );

    return { deliveryId: delivery.id, dueAt: delivery.due_at };
  }

  private async findOrCreatePushDelivery(
    userId: number,
    eventId: number,
    inboxItemId: number,
    dueAt: Date,
    now: Date,
  ) {
    return this.prisma.notificationPushDelivery.upsert({
      where: { notification_inbox_item_id: inboxItemId },
      // A replay retains the committed schedule, outcome and diagnostic history.
      update: { notification_inbox_item_id: inboxItemId },
      create: {
        user_id: userId,
        notification_event_id: eventId,
        notification_inbox_item_id: inboxItemId,
        state: "scheduled",
        due_at: dueAt,
        created_at: now,
        updated_at: now,
      },
    });
  }

  private nextPushDueAt(
    activity: {
      realtimeActive: boolean;
      lastSeenAt: Date | null;
    },
    now: Date,
  ) {
    const dueAt = activity.lastSeenAt
      ? new Date(activity.lastSeenAt.getTime() + RECENT_ACTIVITY_WINDOW_MS)
      : new Date(now.getTime() + RECENT_ACTIVITY_WINDOW_MS);

    return dueAt.getTime() > now.getTime() ? dueAt : now;
  }

  private async sendPush(
    userId: number,
    event: NotificationEventWithRelations,
    badgeCount?: number,
    deliveryId?: number,
    options: { ignoreRecentActivity?: boolean; onExternalAttempt?: () => void } = {},
  ) {
    if (!(await canReadContentNotice(this.circleAccess, this.prisma, userId, event))) {
      if (deliveryId) await this.markPushDelivery(deliveryId, {
        state: "cancelled", cancelled_at: new Date(), skip_reason: "content_unavailable",
      });
      return;
    }
    const activity = await this.userActivityStatus(userId, { includeRecentActivity: !options.ignoreRecentActivity });
    if (activity.isActive) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "push_skip_active",
          user_id: userId,
          event_id: String(event.id),
          realtime_active: activity.realtimeActive,
          last_seen_at: activity.lastSeenAt ? activity.lastSeenAt.toISOString() : null,
          last_seen_recent: activity.lastSeenRecent,
        }),
      );
      if (deliveryId) {
        await this.markPushDelivery(deliveryId, {
          state: "cancelled",
          cancelled_at: new Date(),
          skip_reason: "user_active",
        });
      }
      return;
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { user_id: userId, subscribed: true },
      orderBy: { updated_at: "desc" },
    });
    const usableSubscriptions = subscriptions.filter(
      (
        subscription,
      ): subscription is typeof subscription & {
        endpoint: string;
        p256dh: string;
        auth: string;
      } => Boolean(subscription.endpoint && subscription.p256dh && subscription.auth),
    );
    if (usableSubscriptions.length === 0) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "push_skip_subscription",
          user_id: userId,
          event_id: String(event.id),
          has_subscription: subscriptions.length > 0,
        }),
      );
      if (deliveryId) {
        await this.markPushDelivery(deliveryId, { state: "skipped", skip_reason: "subscription_missing" });
      }
      return;
    }

    const vapidConfig = readVapidConfig();
    const completeVapidConfigs = readCompleteVapidConfigs();
    if (completeVapidConfigs.length === 0) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "push_skip_keys",
          user_id: userId,
          event_id: String(event.id),
          has_public: Boolean(vapidConfig.publicKey),
          has_private: Boolean(vapidConfig.privateKey),
          has_subject: Boolean(vapidConfig.subject),
        }),
      );
      if (deliveryId) {
        await this.markPushDelivery(deliveryId, { state: "skipped", skip_reason: "vapid_keys_missing" });
      }
      return;
    }

    const payload = JSON.stringify({
      title: await this.pushTitle(event, userId),
      body: this.pushBody(event),
      url: event.target_path ?? undefined,
      badgeCount: typeof badgeCount === "number" ? badgeCount : undefined,
      data: { event_id: String(event.id) },
    });

    let sentCount = 0;
    let invalidCount = 0;
    let failedCount = 0;
    let uncertainCount = 0;
    let lastError: unknown;

    // Duplicate subscription rows must not repeat a destination within one pass.
    const destinations = [...new Map(usableSubscriptions.map(subscription => [subscription.endpoint, subscription])).values()];
    for (const subscription of destinations) {
      if (!(await canReadContentNotice(this.circleAccess, this.prisma, userId, event))) {
        if (deliveryId) await this.markPushDelivery(deliveryId, {state:"cancelled",cancelled_at:new Date(),skip_reason:"content_unavailable"});
        return;
      }
      const journal = deliveryId ? await beginPushDeviceAttempt(this.prisma, deliveryId, subscription.id, subscription.endpoint) : null;
      if (journal && !journal.claimed) {
        if (journal.attempt.state === "sent") sentCount += 1;
        else if (journal.attempt.state === "invalid") invalidCount += 1;
        else { uncertainCount += 1; lastError = new Error(journal.attempt.last_error ?? "Prior device attempt has an uncertain outcome"); }
        continue;
      }
      let outcome: "sent" | "invalid" | "rejected" | "uncertain" = "sent";
      let sendError: unknown;
      try {
        options.onExternalAttempt?.();
        await this.sendWithVapidFallback(subscription, payload, completeVapidConfigs, userId, event.id);
      } catch (error) {
        sendError = error;
        lastError = error;
        outcome = pushDeviceFailureState(error);
      }
      // A journal failure must escape, retaining the parent claim. It is not a transport rejection.
      if (journal && !await completePushDeviceAttempt(this.prisma, journal.attempt.id, journal.attempt.attempt_count, outcome,
        outcome === "sent" ? null : this.pushErrorMessage(sendError))) throw new Error("Push device completion lost its attempt fence");
      if (outcome === "sent") sentCount += 1;
      else if (outcome === "invalid") {
        invalidCount += 1;
        await this.prisma.pushSubscription.update({where:{id:subscription.id},data:{subscribed:false,updated_at:new Date()}});
      } else if (outcome === "rejected") failedCount += 1;
      else uncertainCount += 1;
      if (outcome !== "sent") console.error(`Failed to send push notification for event ${String(event.id)}:`, sendError);
    }

    if (!deliveryId) return;

    if (sentCount > 0) {
      await this.markPushDelivery(deliveryId, {
        state: failedCount + uncertainCount > 0 ? "partial" : "sent",
        sent_at: new Date(),
        skip_reason: failedCount + uncertainCount > 0 ? "partial_device_failure" : null,
        last_error: failedCount + uncertainCount > 0
          ? JSON.stringify({ sent: sentCount, invalid: invalidCount, failed: failedCount, uncertain: uncertainCount, error: this.pushErrorMessage(lastError) })
          : null,
      });
      return;
    }

    if (invalidCount > 0 && failedCount === 0 && uncertainCount === 0) {
      await this.markPushDelivery(deliveryId, {
        state: "skipped",
        skip_reason: "subscription_invalid",
        last_error: this.pushErrorMessage(lastError),
      });
      return;
    }

    await this.markPushDelivery(deliveryId, {
      state: uncertainCount > 0 ? "uncertain" : "failed",
      skip_reason: uncertainCount > 0 ? "uncertain_device_outcome" : null,
      last_error: this.pushErrorMessage(lastError),
    });
  }

  private async markPushDelivery(
    deliveryId: number,
    data: {
      state: string;
      sent_at?: Date;
      cancelled_at?: Date;
      skip_reason?: string | null;
      last_error?: string | null;
    },
  ) {
    await this.prisma.notificationPushDelivery.update({
      where: { id: deliveryId },
      data: {
        ...data,
        updated_at: new Date(),
      },
    });
  }

  private async sendWithVapidFallback(
    subscription: { endpoint: string; p256dh: string; auth: string; id: number },
    payload: string,
    vapidConfigs: Array<{ publicKey: string; privateKey: string; subject: string; source: string }>,
    userId: number,
    eventId: number | bigint,
  ) {
    let lastError: unknown;

    for (const [index, vapidConfig] of vapidConfigs.entries()) {
      try {
        const vapidDetails = {
          subject: vapidConfig.subject,
          publicKey: vapidConfig.publicKey,
          privateKey: vapidConfig.privateKey,
        };
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
          { vapidDetails, timeout: PUSH_SOCKET_TIMEOUT_MS },
        );
        return;
      } catch (error) {
        lastError = error;
        const statusCode = (error as { statusCode?: number }).statusCode;
        if ((statusCode === 401 || statusCode === 403) && index < vapidConfigs.length - 1) {
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify({
              event: "push_retry_vapid",
              user_id: userId,
              event_id: String(eventId),
              subscription_id: String(subscription.id),
              failed_vapid_source: vapidConfig.source,
              next_vapid_source: vapidConfigs[index + 1].source,
              status_code: statusCode,
            }),
          );
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  }

  private pushErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;

    try {
      return JSON.stringify(error) ?? String(error);
    } catch {
      return String(error);
    }
  }

  private async pushTitle(event: NotificationEventWithRelations, userId?: number) {
    let actorName = event.actor?.username ?? "Someone";
    const communityName = event.room?.name ?? "";
    const communitySuffix = communityName ? ` in ${communityName}` : "";

    if (event.event_type === "chat_message_saved_as_post") {
      const payload = event.payload as { chat_message_id?: number; format?: string } | null;
      const message = payload?.chat_message_id
        ? await this.prisma.chatMessage.findUnique({
            where: { id: Number(payload.chat_message_id) },
            include: {
              identity_grants: { where: { user_id: userId ?? 0 }, select: { user_id: true } },
            },
          })
        : null;
      const identityVisible =
        !message ||
        event.room?.porosity === "open" ||
        Number(event.actor_id) === Number(userId) ||
        Boolean(message.identity_grants?.length);
      if (!identityVisible && message) actorName = message.masked_alias;
      const formatLabel =
        payload?.format === "image"
          ? "an image post"
          : payload?.format === "video"
            ? "a video post"
            : payload?.format === "audio"
              ? "an audio post"
              : payload?.format === "link"
                ? "a link post"
                : "a post";
      return `${actorName} saved a chat message as ${formatLabel}${communitySuffix}`;
    }

    if (event.event_type === "post_created") {
      return `${actorName} posted${communitySuffix}`;
    }
    if (event.event_type === "reply_created") {
      return `${actorName} replied${communitySuffix}`;
    }
    if (event.event_type === "mention") {
      return `${actorName} mentioned you${communitySuffix}`;
    }
    if (event.event_type === "introduction_created") {
      return `${actorName} made an introduction${communitySuffix}`;
    }
    if (event.event_type === "chat_save_requested") {
      return `${actorName} asked to save a chat message${communitySuffix}`;
    }
    if (event.event_type === "chat_reply_created") {
      return `${actorName} replied to your post${communitySuffix}`;
    }
    if (event.event_type === "chat_message_created") {
      return `${actorName} messaged${communitySuffix}`;
    }
    if (event.event_type === "circle_member_invited") {
      return `${actorName} invited you to ${communityName || "a Circle"}`;
    }
    if (event.event_type === "circle_knock_suggested") {
      return `${actorName} suggested you knock on ${communityName || "a Circle"}`;
    }
    if (event.event_type === "circle_join_requested") {
      return `${actorName} asked to join ${communityName || "your Circle"}`;
    }
    if (event.event_type === "circle_join_approved") {
      return `${actorName} approved your request to join ${communityName || "a Circle"}`;
    }
    if (event.event_type === "round_reminder") {
      return `Reminder for ${this.activityName(event)}`;
    }
    if (event.event_type === "round_phase_changed") {
      const milestone = (event.payload as { milestone?: string } | null)?.milestone;
      const activityName = this.activityName(event);
      if (milestone === "round_completed") return `${activityName} is complete`;
      if (milestone === "submission_started") return `${activityName} is open`;
      if (milestone === "feedback_started") return `${activityName} is ready for responses`;
      return `${activityName} has an update`;
    }
    if (event.event_type === "round_deadline_approaching") {
      return `${this.activityName(event)} is due soon`;
    }
    if (event.event_type === "round_contribution_removed") {
      return `Your contribution was removed from ${this.activityName(event)}`;
    }
    return "New activity";
  }

  private pushBody(event: NotificationEventWithRelations) {
    if (event.event_type === "circle_member_invited") {
      return "Tap to open the Circle and respond.";
    }
    if (event.event_type === "circle_knock_suggested") {
      return "Tap to visit the Circle and knock.";
    }
    if (event.event_type === "chat_message_saved_as_post") {
      const excerpt = (event.payload as { excerpt?: string } | null)?.excerpt ?? "";
      const shortened = excerpt.length > 88 ? `${excerpt.slice(0, 85)}...` : excerpt;
      return shortened ? `Now preserved on the board: "${shortened}"` : "Now preserved on the board.";
    }
    if (event.event_type === "introduction_created") {
      const payload = event.payload as { otherRecipientName?: string; note?: string } | null;
      const otherRecipientName = payload?.otherRecipientName;
      const prefix = otherRecipientName ? `For you and ${otherRecipientName}. ` : "";
      const note = payload?.note ?? "";
      const body = `${prefix}${note}`.trim();
      return body.length > 120 ? `${body.slice(0, 117)}...` : body;
    }

    const excerpt = (event.payload as { excerpt?: string } | null)?.excerpt ?? "";
    return excerpt.length > 120 ? `${excerpt.slice(0, 117)}...` : excerpt;
  }

  private activityName(event: NotificationEventWithRelations) {
    const payload = event.payload as { activity_name?: unknown; round_name?: unknown } | null;
    const value = payload?.activity_name ?? payload?.round_name;
    return typeof value === "string" && value.trim() ? value.trim() : "The activity";
  }

  private async userActivityStatus(
    userId: number,
    options: { includeRecentActivity?: boolean } = {},
  ): Promise<{
    isActive: boolean;
    realtimeActive: boolean;
    lastSeenAt: Date | null;
    lastSeenRecent: boolean;
  }> {
    const includeRecentActivity = options.includeRecentActivity ?? true;
    const realtimeActive = this.realtime.isUserActive(userId);
    if (realtimeActive) {
      return { isActive: true, realtimeActive, lastSeenAt: null, lastSeenRecent: false };
    }

    if (!includeRecentActivity) {
      return { isActive: false, realtimeActive, lastSeenAt: null, lastSeenRecent: false };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { last_seen_at: true },
    });

    if (!user?.last_seen_at) {
      return { isActive: false, realtimeActive, lastSeenAt: null, lastSeenRecent: false };
    }
    const twoMinutesAgo = Date.now() - RECENT_ACTIVITY_WINDOW_MS;
    const lastSeenRecent = user.last_seen_at.getTime() > twoMinutesAgo;
    return {
      isActive: lastSeenRecent,
      realtimeActive,
      lastSeenAt: user.last_seen_at,
      lastSeenRecent,
    };
  }
}
