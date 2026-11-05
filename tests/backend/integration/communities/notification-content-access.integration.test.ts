import "reflect-metadata"
import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { canReadContentNotice } from "@server/notifications/notification-access"
import { NotificationInboxSerializer } from "@server/notifications/notification-inbox.serializer"
import { NotificationDeliveryService } from "@server/notifications/notification-delivery.service"

it("withholds retained Entry and Reply notices after live audience or publication changes", async () => {
  const prisma = new PrismaClient(), rollback = new Error("Rollback notice fixture"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@notice.test`, username: "Reader", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Private", porosity: "closed", created_at: now, updated_at: now } })
      const membership = await tx.roomMembership.create({ data: { user_id: user.id, room_id: room.id, created_at: now, updated_at: now } })
      const post = await tx.entry.create({ data: { user_id: user.id, room_id: room.id, status: "published", created_at: now, updated_at: now } })
      const other = await tx.entry.create({ data: { user_id: user.id, room_id: room.id, status: "published", created_at: now, updated_at: now } })
      const reply = await tx.reply.create({ data: { user_id: user.id, entry_id: post.id, status: "published", created_at: now, updated_at: now } })
      const access = new RoomAccessService()
      Object.assign(access, { prisma: tx })
      const inbox = new NotificationInboxSerializer()
      Object.assign(inbox, { prisma: tx, circleAccess: access })
      const delivery = new NotificationDeliveryService()
      Object.assign(delivery, { prisma: tx, circleAccess: access })
      const event = { id: 1, actor_id: user.id, room_id: room.id, event_type: "reply_created", entry_id: null, target_path: `/app/entries/${post.id}#reply-${reply.id}`, payload: { excerpt: "Retained private text" }, created_at: now }
      const readable = () => canReadContentNotice(access, tx, user.id, event)
      const withheld = async () => {
        expect(await readable()).toBe(false)
        expect(await inbox.serialize([{ id: 1, user_id: user.id, delivery_state: "delivered", notification_event: event }])).toEqual([])
        // Missing downstream collaborators make any attempt to hydrate/send fail.
        expect(await delivery.deliverImmediately(user.id, event as never, { pushEnabled: true } as never)).toEqual({ inboxItem: null, scheduledPushDelivery: undefined })
      }
      expect(await readable()).toBe(true)
      await tx.reply.update({ where: { id: reply.id }, data: { entry_id: other.id } })
      await withheld()
      await tx.reply.update({ where: { id: reply.id }, data: { entry_id: post.id, status: "deleted" } })
      await withheld()
      await tx.reply.update({ where: { id: reply.id }, data: { status: "published" } })
      await tx.entry.update({ where: { id: post.id }, data: { status: "deleted" } })
      await withheld()
      await tx.entry.update({ where: { id: post.id }, data: { status: "published" } })
      await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
      await withheld()
      await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: false } })
      expect(await readable()).toBe(true)
      await tx.room.update({ where: { id: room.id }, data: { deleted_at: now } })
      await withheld()
      expect(await tx.entry.count({ where: { id: { in: [post.id, other.id] } } })).toBe(2)
      expect(await tx.reply.count({ where: { id: reply.id } })).toBe(1)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})

it("applies limited visitor current-entry and lease boundaries without renewing visits", async () => {
  const prisma = new PrismaClient(), rollback = new Error("Rollback visitor notice fixture"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      const author = await tx.user.create({ data: { email: `${crypto.randomUUID()}@notice.test`, username: "Author", created_at: now, updated_at: now } })
      const visitor = await tx.user.create({ data: { email: `${crypto.randomUUID()}@notice.test`, username: "Visitor", created_at: now, updated_at: now } })
      const parent = await tx.room.create({ data: { name: "Parent", porosity: "closed", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Ajar", parent_id: parent.id, porosity: "masked", created_at: now, updated_at: now } })
      const parentMembership = await tx.roomMembership.create({ data: { user_id: visitor.id, room_id: parent.id, created_at: now, updated_at: now } })
      const authorMembership = await tx.roomMembership.create({ data: { user_id: author.id, room_id: room.id, created_at: now, updated_at: now } })
      const project = await tx.project.create({ data: { owner_id: author.id, name: "Private", created_at: now, updated_at: now } })
      const source = await tx.entry.create({ data: { user_id: author.id, project_id: project.id, creation_origin: "project_material", status: "published", created_at: now, updated_at: now } })
      const entries = []
      for (let i = 0; i < 2; i++) entries.push(await tx.entry.create({ data: { user_id: author.id, room_id: room.id, source_entry_id: source.id, status: i === 0 ? "published" : "draft", published_at: new Date(now.getTime() + i), created_at: now, updated_at: now } }))
      const lease = await tx.roomVisit.create({ data: { room_id: room.id, user_id: visitor.id, source: "porosity", last_activity_at: now, expires_at: new Date(now.getTime() + 86400000), created_at: now } })
      const access = new RoomAccessService()
      Object.assign(access, { prisma: tx })
      const inbox = new NotificationInboxSerializer()
      Object.assign(inbox, { prisma: tx, circleAccess: access })
      const round = await tx.round.create({ data: { room_id: room.id, host_id: author.id, name: "Round", status: "active", created_at: now, updated_at: now } })
      const roundEvent = { id: 2, actor_id: author.id, room_id: room.id, event_type: "round_phase_changed", payload: { round_id: round.id, activity_name: "Retained Round" }, target_path: `/app/rounds/${round.id}`, created_at: now }
      const roundReadable = () => canReadContentNotice(access, tx, visitor.id, roundEvent)
      const roundWithheld = async () => {
        expect(await roundReadable()).toBe(false)
        expect(await inbox.serialize([{ id: 2, user_id: visitor.id, delivery_state: "delivered", notification_event: roundEvent }])).toEqual([])
        const delivery = new NotificationDeliveryService()
        Object.assign(delivery, { prisma: tx, circleAccess: access })
        expect(await delivery.deliverImmediately(visitor.id, roundEvent as never, { pushEnabled: true } as never)).toEqual({ inboxItem: null, scheduledPushDelivery: undefined })
      }
      expect(await roundReadable()).toBe(true)
      await tx.round.update({ where: { id: round.id }, data: { status: "archived" } })
      await roundWithheld()
      await tx.room.update({ where: { id: room.id }, data: { porosity: "open" } })
      expect(await roundReadable()).toBe(true)
      await tx.round.update({ where: { id: round.id }, data: { status: "draft" } })
      await roundWithheld()
      expect(await canReadContentNotice(access, tx, author.id, roundEvent)).toBe(true)
      await tx.round.update({ where: { id: round.id }, data: { status: "active" } })
      await tx.room.update({ where: { id: room.id }, data: { porosity: "masked" } })
      const event = { id: 1, actor_id: author.id, room_id: room.id, event_type: "post_created", entry_id: entries[0].id, payload: { excerpt: "Old entry" }, created_at: now }
      const readable = () => canReadContentNotice(access, tx, visitor.id, event)
      const withheld = async () => {
        expect(await readable()).toBe(false)
        expect(await inbox.serialize([{ id: 1, user_id: visitor.id, delivery_state: "delivered", notification_event: event }])).toEqual([])
      }
      expect(await readable()).toBe(true)
      // Publishing a newer share supersedes the old notice without a separate current-entry pointer.
      await tx.entry.update({ where: { id: entries[1].id }, data: { status: "published" } })
      await withheld()
      // Open history can expose the old Entry while the visitor lease is live.
      await tx.room.update({ where: { id: room.id }, data: { porosity: "open" } })
      expect(await readable()).toBe(true)
      await tx.room.update({ where: { id: room.id }, data: { porosity: "masked" } })
      await tx.entry.update({ where: { id: entries[1].id }, data: { status: "deleted" } })
      expect(await readable()).toBe(true)
      await tx.roomMembership.update({ where: { id: authorMembership.id }, data: { disabled: true } })
      await withheld()
      await tx.roomMembership.update({ where: { id: authorMembership.id }, data: { disabled: false } })
      await tx.roomMembership.update({ where: { id: parentMembership.id }, data: { disabled: true } })
      await withheld()
      await roundWithheld()
      await tx.roomMembership.update({ where: { id: parentMembership.id }, data: { disabled: false } })
      expect(await readable()).toBe(true)
      expect(await tx.roomVisit.findUnique({ where: { room_id_user_id: { room_id: room.id, user_id: visitor.id } } })).toEqual(lease)
      const expired = await tx.roomVisit.update({ where: { room_id_user_id: { room_id: room.id, user_id: visitor.id } }, data: { last_activity_at: new Date(now.getTime() - 86400001), expires_at: new Date(now.getTime() - 1) } })
      await withheld()
      await roundWithheld()
      expect(await tx.roomVisit.findUnique({ where: { room_id_user_id: { room_id: room.id, user_id: visitor.id } } })).toEqual(expired)
      expect(await tx.entry.count({ where: { room_id: room.id, user_id: author.id } })).toBe(2)
      throw rollback
    }, { timeout: 10000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})

it("withholds introductions after hiding, retraction or membership loss", async () => {
  const prisma = new PrismaClient(), rollback = new Error("Rollback introduction fixture"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      const author = await tx.user.create({ data: { email: `${crypto.randomUUID()}@intro-notice.test`, username: "Author", created_at: now, updated_at: now } })
      const reader = await tx.user.create({ data: { email: `${crypto.randomUUID()}@intro-notice.test`, username: "Reader", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Room", created_at: now, updated_at: now } })
      const membership = await tx.roomMembership.create({ data: { user_id: reader.id, room_id: room.id, created_at: now, updated_at: now } })
      const intro = await tx.introduction.create({ data: { room_id: room.id, created_by_id: author.id, note: "Private introduction", created_at: now, updated_at: now,
        recipients: { create: { user_id: reader.id, created_at: now, updated_at: now } } } })
      const access = new RoomAccessService()
      Object.assign(access, { prisma: tx })
      const inbox = new NotificationInboxSerializer(), delivery = new NotificationDeliveryService()
      Object.assign(inbox, { prisma: tx, circleAccess: access })
      Object.assign(delivery, { prisma: tx, circleAccess: access })
      const event = { id: 1, event_type: "introduction_created", actor_id: author.id, room_id: room.id, payload: { introductionId: intro.id, note: intro.note }, created_at: now }
      const readable = () => canReadContentNotice(access, tx, reader.id, event)
      const withheld = async () => {
        expect(await readable()).toBe(false)
        expect(await inbox.serialize([{ id: 1, user_id: reader.id, delivery_state: "delivered", notification_event: event }])).toEqual([])
        expect(await delivery.deliverImmediately(reader.id, event as never, { pushEnabled: true } as never)).toEqual({ inboxItem: null, scheduledPushDelivery: undefined })
      }
      expect(await readable()).toBe(true)
      expect(await canReadContentNotice(access, tx, author.id, event)).toBe(false)
      await tx.introductionRecipient.updateMany({ where: { introduction_id: intro.id }, data: { hidden_at: now } })
      await withheld()
      await tx.introductionRecipient.updateMany({ where: { introduction_id: intro.id }, data: { hidden_at: null } })
      await tx.introduction.update({ where: { id: intro.id }, data: { retracted_at: now } })
      await withheld()
      await tx.introduction.update({ where: { id: intro.id }, data: { retracted_at: null } })
      await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
      await withheld()
      expect(await tx.introduction.count({ where: { id: intro.id } })).toBe(1)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})

it("keeps a pending invitation readable to its recipient without granting a visit", async () => {
  const prisma = new PrismaClient(), rollback = new Error("Rollback invitation fixture"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@invitation-notice.test`, username: "Recipient", created_at: now, updated_at: now } })
      const inviter = await tx.user.create({ data: { email: `${crypto.randomUUID()}@invitation-notice.test`, username: "Inviter", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Closed Room", porosity: "closed", created_at: now, updated_at: now } })
      const invitation = await tx.roomMemberInvitation.create({ data: { room_id: room.id, user_id: user.id, invited_by_id: inviter.id, status: "pending", created_at: now, updated_at: now } })
      const access = new RoomAccessService()
      Object.assign(access, { prisma: tx })
      const inbox = new NotificationInboxSerializer(), delivery = new NotificationDeliveryService()
      Object.assign(inbox, { prisma: tx, circleAccess: access })
      Object.assign(delivery, { prisma: tx, circleAccess: access })
      const event = { id: 1, event_type: "circle_member_invited", actor_id: inviter.id, room_id: room.id, payload: { invitation_id: invitation.id }, target_path: `/app/rooms/${room.id}`, created_at: now }
      const readable = () => canReadContentNotice(access, tx, user.id, event)
      const withheld = async () => {
        expect(await readable()).toBe(false)
        expect(await inbox.serialize([{ id: 1, user_id: user.id, delivery_state: "delivered", notification_event: event }])).toEqual([])
        expect(await delivery.deliverImmediately(user.id, event as never, { pushEnabled: true } as never)).toEqual({ inboxItem: null, scheduledPushDelivery: undefined })
      }
      expect(await access.resolve(room.id, user.id)).toBeNull()
      expect(await readable()).toBe(true)
      await tx.roomMemberInvitation.update({ where: { id: invitation.id }, data: { status: "revoked" } })
      await withheld()
      await tx.roomMemberInvitation.update({ where: { id: invitation.id }, data: { status: "pending" } })
      await tx.room.update({ where: { id: room.id }, data: { deleted_at: now } })
      await withheld()
      expect(await tx.roomVisit.count({ where: { room_id: room.id } })).toBe(0)
      expect(await tx.roomMemberInvitation.count({ where: { id: invitation.id } })).toBe(1)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})

it("withholds knock suggestions after parent access or child eligibility changes", async () => {
  const prisma = new PrismaClient(), rollback = new Error("Rollback suggestion fixture"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@suggestion-notice.test`, username: "Recipient", created_at: now, updated_at: now } })
      const parent = await tx.room.create({ data: { name: "Parent", created_at: now, updated_at: now } })
      const child = await tx.room.create({ data: { name: "Child", parent_id: parent.id, porosity: "closed", created_at: now, updated_at: now } })
      const membership = await tx.roomMembership.create({ data: { room_id: parent.id, user_id: user.id, created_at: now, updated_at: now } })
      const access = new RoomAccessService()
      Object.assign(access, { prisma: tx })
      const inbox = new NotificationInboxSerializer(), delivery = new NotificationDeliveryService()
      Object.assign(inbox, { prisma: tx, circleAccess: access })
      Object.assign(delivery, { prisma: tx, circleAccess: access })
      const event = { id: 1, actor_id: user.id, event_type: "circle_knock_suggested", room_id: child.id, target_user_id: user.id, target_path: `/app/rooms/${parent.id}/adjacent-rooms`, created_at: now }
      const readable = () => canReadContentNotice(access, tx, user.id, event)
      const withheld = async () => {
        expect(await readable()).toBe(false)
        expect(await inbox.serialize([{ id: 1, user_id: user.id, delivery_state: "delivered", notification_event: event }])).toEqual([])
        expect(await delivery.deliverImmediately(user.id, event as never, { pushEnabled: true } as never)).toEqual({ inboxItem: null, scheduledPushDelivery: undefined })
      }
      expect(await readable()).toBe(true)
      expect(await canReadContentNotice(access, tx, user.id, { ...event, target_user_id: user.id + 1 })).toBe(false)
      await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
      await withheld()
      await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: false } })
      for (const porosity of ["open", "masked"]) {
        await tx.room.update({ where: { id: child.id }, data: { porosity } })
        await withheld()
      }
      await tx.room.update({ where: { id: child.id }, data: { porosity: "closed", deleted_at: now } })
      await withheld()
      await tx.room.update({ where: { id: child.id }, data: { deleted_at: null } })
      await tx.roomMembership.create({ data: { room_id: child.id, user_id: user.id, created_at: now, updated_at: now } })
      await withheld()
      expect(await tx.roomVisit.count({ where: { user_id: user.id } })).toBe(0)
      expect(await tx.roomKnock.count({ where: { user_id: user.id } })).toBe(0)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})

it("rechecks join-notice management and approved membership against persisted changes", async () => {
  const prisma = new PrismaClient(), rollback = new Error("Rollback join notice fixture"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      const owner = await tx.user.create({ data: { email: `${crypto.randomUUID()}@join-notice.test`, username: "Owner", created_at: now, updated_at: now } })
      const applicant = await tx.user.create({ data: { email: `${crypto.randomUUID()}@join-notice.test`, username: "Applicant", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Room", owner_id: owner.id, created_at: now, updated_at: now } })
      await tx.roomMembership.create({ data: { room_id: room.id, user_id: owner.id, created_at: now, updated_at: now } })
      const membership = await tx.roomMembership.create({ data: { room_id: room.id, user_id: applicant.id, created_at: now, updated_at: now } })
      const request = await tx.roomJoinRequest.create({ data: { room_id: room.id, user_id: applicant.id, status: "approved", created_at: now, updated_at: now } })
      const access = new RoomAccessService()
      Object.assign(access, { prisma: tx })
      const inbox = new NotificationInboxSerializer(), delivery = new NotificationDeliveryService()
      Object.assign(inbox, { prisma: tx, circleAccess: access })
      Object.assign(delivery, { prisma: tx, circleAccess: access })
      const requested = { id: 1, actor_id: applicant.id, event_type: "circle_join_requested", room_id: room.id, target_user_id: owner.id, payload: { join_request_id: request.id }, created_at: now }
      const approved = { ...requested, id: 2, actor_id: owner.id, event_type: "circle_join_approved", target_user_id: applicant.id }
      const withheld = async (userId: number, event: typeof requested) => {
        expect(await canReadContentNotice(access, tx, userId, event)).toBe(false)
        expect(await inbox.serialize([{ id: event.id, user_id: userId, delivery_state: "delivered", notification_event: event }])).toEqual([])
        expect(await delivery.deliverImmediately(userId, event as never, { pushEnabled: true } as never)).toEqual({ inboxItem: null, scheduledPushDelivery: undefined })
      }
      expect(await canReadContentNotice(access, tx, owner.id, requested)).toBe(true)
      expect(await canReadContentNotice(access, tx, applicant.id, approved)).toBe(true)
      await tx.room.update({ where: { id: room.id }, data: { owner_id: applicant.id } })
      await withheld(owner.id, requested)
      await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
      await withheld(applicant.id, approved)
      await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: false } })
      await tx.roomJoinRequest.update({ where: { id: request.id }, data: { status: "declined" } })
      await withheld(applicant.id, approved)
      await tx.roomJoinRequest.update({ where: { id: request.id }, data: { status: "approved" } })
      await tx.room.update({ where: { id: room.id }, data: { deleted_at: now } })
      await withheld(applicant.id, approved)
      expect(await tx.roomJoinRequest.count({ where: { id: request.id } })).toBe(1)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})

it("withholds retained Chat save requests after message expiry", async () => {
  const prisma = new PrismaClient(), rollback = new Error("Rollback Chat request fixture"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      const owner = await tx.user.create({ data: { email: `${crypto.randomUUID()}@chat-notice.test`, username: "Owner", created_at: now, updated_at: now } })
      const requester = await tx.user.create({ data: { email: `${crypto.randomUUID()}@chat-notice.test`, username: "Requester", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Room", created_at: now, updated_at: now } })
      await tx.roomMembership.create({ data: { room_id: room.id, user_id: owner.id, created_at: now, updated_at: now } })
      const message = await tx.chatMessage.create({ data: { room_id: room.id, author_id: owner.id, body: "Retained excerpt", masked_alias: "Owner", fire_at: new Date(now.getTime() + 86400000), expires_at: new Date(now.getTime() + 86400000), created_at: now, updated_at: now } })
      const request = await tx.chatSaveRequest.create({ data: { message_id: message.id, owner_id: owner.id, requester_id: requester.id, created_at: now, updated_at: now } })
      const access = new RoomAccessService()
      Object.assign(access, { prisma: tx })
      const inbox = new NotificationInboxSerializer(), delivery = new NotificationDeliveryService()
      Object.assign(inbox, { prisma: tx, circleAccess: access })
      Object.assign(delivery, { prisma: tx, circleAccess: access })
      const event = { id: 1, actor_id: requester.id, event_type: "chat_save_requested", room_id: room.id, target_user_id: owner.id, payload: { chat_message_id: message.id, chat_save_request_id: request.id, excerpt: message.body }, created_at: now }
      const reply = await tx.reply.create({ data: { chat_message_id: message.id, user_id: requester.id, status: "published", created_at: now, updated_at: now } })
      const replyEvent = { ...event, event_type: "chat_reply_created", payload: { chat_message_id: message.id, replyId: reply.id } }
      expect(await canReadContentNotice(access, tx, owner.id, replyEvent)).toBe(true)
      expect(await canReadContentNotice(access, tx, owner.id, event)).toBe(true)
      await tx.chatMessage.update({ where: { id: message.id }, data: { expires_at: new Date(now.getTime() - 1) } })
      expect(await canReadContentNotice(access, tx, owner.id, event)).toBe(false)
      expect(await canReadContentNotice(access, tx, owner.id, replyEvent)).toBe(false)
      expect(await inbox.serialize([{ id: 2, user_id: owner.id, delivery_state: "delivered", notification_event: replyEvent }])).toEqual([])
      expect(await inbox.serialize([{ id: 1, user_id: owner.id, delivery_state: "delivered", notification_event: event }])).toEqual([])
      expect(await delivery.deliverImmediately(owner.id, event as never, { pushEnabled: true } as never)).toEqual({ inboxItem: null, scheduledPushDelivery: undefined })
      expect(await tx.chatSaveRequest.count({ where: { id: request.id } })).toBe(1)
      expect(await tx.chatMessage.count({ where: { id: message.id } })).toBe(1)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
