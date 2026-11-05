import {
  serializeFirstEntryPrompts,
  serializeRoom,
  serializeRoomMembers,
  serializeNotePayload,
  serializeNoteTree,
  serializeNotificationPreferenceItem,
  serializeSlideMenu,
} from "@server/api/v2/serializers"

describe("v2 serializers", () => {
  it("keeps explicit circle access and the viewer's pending invitation", () => {
    const viewerInvitation = {
      id: 90, room_id: 2, status: "pending", user: { id: 7, display_username: "Mira", avatar_url: null },
      invited_by: { id: 8, display_username: "Ada" }, created_at: "2026-09-08T12:00:00.000Z", responded_at: null,
    }

    expect(
      serializeRoom({
        replySettings: { replyMode: "guided", defaultFeedbackTypes: ["question"], defaultIdeaGuidance: "craft" },
        id: 2,
        name: "A",
        owner_id: 8,
        canManage: false,
        porosity: "open",
        porosity_label: "Open",
        parent: null,
        membership_state: "visitor",
        access: {
          kind: "visitor", can_manage: false, can_create_adjacent_room: false, can_view_notes: false,
          can_write_wall: false, can_participate_rounds: false,
        },
        viewer_invitation: viewerInvitation,
      }),
    ).toMatchObject({
      replySettings: { replyMode: "guided", defaultFeedbackTypes: ["question"], defaultIdeaGuidance: "craft" },
      access: { kind: "visitor", can_view_notes: false },
      porosity_label: "Open",
      viewer_invitation: viewerInvitation,
    })
  })

  it("serializes member circle IDs from the authorized route context", () => {
    const member = {
      id: 14, user_id: 7, display_username: "Mira", display_avatar_url: null, avatar_url: null, square_id: 31,
      presence: { is_here: true, last_seen_at: null },
      location: { room_id: 2, name: "Studio", is_private: false },
    }
    const serialized = serializeRoomMembers({ members: [member] }, 2)

    expect(JSON.parse(JSON.stringify(serialized))).toEqual({ members: [{ ...member, room_id: 2 }] })
    expect(serializeRoomMembers({ members: [] }, 2)).toEqual({ members: [] })
  })

  it("serializes page payloads as notes", () => {
    expect(
      serializeNotePayload({
        page: { id: 1, title: "Plan", icon: null, room_id: 2, parent_id: null, content: { type: "doc" } },
      }),
    ).toMatchObject({
      note: { id: 1, title: "Plan", room_id: 2, parent_id: null },
    })
  })

  it("serializes page trees as note trees", () => {
    expect(
      serializeNoteTree({
        room_id: 2,
        pages: [{
          id: 1, title: "Root", icon: null, parent_id: null, updated_at: null,
          children: [{ id: 3, title: "Child", icon: null, parent_id: 1, updated_at: null, children: [] }],
        }],
      }),
    ).toMatchObject({
      room_id: 2,
      notes: [{ id: 1, children: [{ id: 3 }] }],
    })
  })

  it("serializes circle menu and prompt payloads", () => {
    expect(
      serializeSlideMenu({
        rooms: [{ id: "2", name: "A", owner_id: 7, canManage: true, avatar_url: null, porosity: "open", }],
        currentRoom: {
          id: "2", name: "A", owner_id: 7, canManage: true, avatar_url: null, porosity: "open",
          pages: [{ id: "9", title: "N", icon: null }],
        },
      }),
    ).toMatchObject({
      rooms: [{ id: "2" }],
      currentRoom: { id: "2", notes: [{ id: "9" }] },
    })

    expect(
      serializeFirstEntryPrompts({
        default_prompt: "Share",
        room_prompt: "Start",
        effective_room_prompt: "Start",
        members: [],
      }),
    ).toMatchObject({ room_prompt: "Start", effective_room_prompt: "Start" })
  })

  it("serializes notification preferences with circle fields", () => {
    expect(
      serializeNotificationPreferenceItem({
        room_id: 2,
        room_name: "A",
        room_avatar_url: "/avatar",
        notification_type: "posts",
      }),
    ).toEqual({
      room_id: 2,
      room_name: "A",
      room_avatar_url: "/avatar",
      notification_type: "entries",
    })
  })
})
