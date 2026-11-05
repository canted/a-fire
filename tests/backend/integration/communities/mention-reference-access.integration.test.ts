import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { grantRoomVisit } from "@server/api/v1/rooms/room-visit-lease"
import { authorizeMentionReferences, lockMentionReferenceAccess } from "@server/api/v1/mentions/mention-reference-access"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("checks protected mention targets against persisted Room authority", async () => {
  const prisma = new PrismaService(), rollback = new Error("rollback mentions")
  try {
    await prisma.$transaction(async tx => {
      const now = new Date()
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@mentions.test`, username: "Fixture", created_at: now, updated_at: now } })
      const rooms = await tx.room.createManyAndReturn({ data: ["Accessible", "Private"].map(name => ({ name, owner_id: user.id, porosity: "closed", created_at: now, updated_at: now })) })
      const [room, privateRoom] = rooms
      await tx.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
      const access = withTestDependencies(new RoomAccessService(), { prisma: tx })
      const notes = await tx.page.createManyAndReturn({ data: rooms.map(item => ({ room_id: item.id, title: "Note", created_at: now, updated_at: now })) })
      const round = await tx.round.create({ data: { room_id: room.id, host_id: user.id, name: "Round", status: "active", created_at: now, updated_at: now } })
      const document = (targetType: string, targetId: number) => ({ type: "doc", content: [{ type: "mention", attrs: { targetType, targetId: String(targetId), label: "Reference", href: "/app/note/999" } }] })
      const validate = (type: string, id: number) => authorizeMentionReferences(tx, access, document(type, id), user.id, room.id)
      expect(await validate("page", notes[0].id)).toMatchObject({ content: [{ attrs: { href: `/app/note/${notes[0].id}` } }] })
      expect(await validate("activity", round.id)).toMatchObject({ content: [{ attrs: { href: `/app/rounds/${round.id}` } }] })
      await expect(validate("page", notes[1].id)).rejects.toThrow("Mention unavailable")
      await expect(validate("circle", privateRoom.id)).rejects.toThrow("Mention unavailable")
      expect(await validate("note", notes[0].id)).toMatchObject({ content: [{ attrs: { href: `/app/note/${notes[0].id}` } }] })
      expect(await validate("round", round.id)).toMatchObject({ content: [{ attrs: { href: `/app/rounds/${round.id}` } }] })
      await expect(validate("room", privateRoom.id)).rejects.toThrow("Mention unavailable")
      await expect(validate("note", notes[1].id)).rejects.toThrow("Mention unavailable")
      const privateUserMention = document("user", user.id)
      privateUserMention.content[0].attrs.href = `/app/circles/${room.id}/members/${user.id}`
      await expect(authorizeMentionReferences(tx, access, privateUserMention, user.id, null)).resolves.toMatchObject({ content: [{ attrs: { href: `/app/rooms/${room.id}/members/${user.id}` } }] })
      privateUserMention.content[0].attrs.href = `/app/rooms/${privateRoom.id}/members/${user.id}`
      await expect(authorizeMentionReferences(tx, access, privateUserMention, user.id, null)).rejects.toThrow("Mention unavailable")
      // Each user mention retains its own Room context, even for the same identity.
      const allowedUserMention = document("user", user.id)
      allowedUserMention.content[0].attrs.href = `/app/rooms/${room.id}/members/${user.id}`
      await expect(authorizeMentionReferences(tx, access, { type: "doc", content: [...allowedUserMention.content, ...privateUserMention.content] }, user.id, null)).rejects.toThrow("Mention unavailable")
      await expect(validate("page", 2147483648)).rejects.toThrow("Invalid mention")
      await expect(lockMentionReferenceAccess(tx, {
        async requireAccessesInTransaction(...args) {
          const contexts = await access.requireAccessesInTransaction(...args)
          // Simulate scope changing between discovery and the target-row lock.
          await tx.page.update({ where: { id: notes[0].id }, data: { room_id: privateRoom.id } })
          return contexts
        },
      }, [document("page", notes[0].id)], user.id, room.id)).rejects.toThrow("Mention scope changed")
      await tx.page.update({ where: { id: notes[0].id }, data: { room_id: room.id } })
      const visitor = await tx.user.create({ data: { email: `${crypto.randomUUID()}@visitor-mentions.test`, username: "Visitor", created_at: now, updated_at: now } })
      await tx.roomMembership.create({ data: { room_id: privateRoom.id, user_id: visitor.id, created_at: now, updated_at: now } })
      await tx.room.update({ where: { id: room.id }, data: { parent_id: privateRoom.id } })
      const visitorValidate = (type: string, id: number) => authorizeMentionReferences(tx, access, document(type, id), visitor.id, room.id)
      for (const porosity of ["open", "masked", "closed"]) {
        await tx.room.update({ where: { id: room.id }, data: { porosity } })
        if (porosity === "closed") await tx.roomKnock.create({ data: { room_id: room.id, user_id: visitor.id, status: "admitted", reviewed_by_id: user.id, reviewed_at: now, created_at: now, updated_at: now } })
        await grantRoomVisit(tx, room.id, visitor.id, porosity === "closed" ? "knock" : "porosity", new Date())
        await expect(visitorValidate("page", notes[0].id)).rejects.toThrow("Mention unavailable")
        await expect(visitorValidate("circle", room.id)).resolves.toMatchObject({ content: [{ attrs: { href: `/app/rooms/${room.id}` } }] })
        for (const status of ["draft", "active", "archived", "cancelled"]) {
          await tx.round.update({ where: { id: round.id }, data: { status } })
          if (status === "active" || porosity === "open" && status === "archived") await expect(visitorValidate("activity", round.id)).resolves.toBeDefined()
          else await expect(visitorValidate("activity", round.id)).rejects.toThrow("Mention unavailable")
        }
      }
      await tx.roomVisit.update({ where: { room_id_user_id: { room_id: room.id, user_id: visitor.id } }, data: { last_activity_at: new Date(now.getTime() - 86400000), expires_at: now } })
      await expect(visitorValidate("circle", room.id)).rejects.toThrow("Mention unavailable")
      await grantRoomVisit(tx, room.id, visitor.id, "knock", new Date())
      await tx.roomMembership.updateMany({ where: { room_id: privateRoom.id, user_id: visitor.id }, data: { disabled: true } })
      await expect(visitorValidate("circle", room.id)).rejects.toThrow("Mention unavailable")
      await tx.page.update({ where: { id: notes[0].id }, data: { deleted_at: now } })
      await expect(validate("page", notes[0].id)).rejects.toThrow("Mention unavailable")
      await tx.round.update({ where: { id: round.id }, data: { room_id: privateRoom.id } })
      await expect(validate("activity", round.id)).rejects.toThrow("Mention unavailable")
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
