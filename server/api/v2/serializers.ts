import { notificationTypeToApi } from "../notification-preferences/notification-preference-contract"
import type { RoomPayload, RoomMemberPayload } from "../v1/rooms/rooms.service"
import type { RoomFirstEntryPromptsPayload } from "../v1/rooms/room-banners.service"
import type { SlideMenuRoom, SlideMenuPage, SlideMenuPayload } from "../v1/navigation/navigation.service"
import type { PagePayload, PageTreeNode, PageTreePayload } from "../v1/pages/pages.service"
import type { NotificationPreferencesService } from "../../notifications/notification-preferences.service"

type RoomMembersPayload = { members: Array<RoomMemberPayload & { room_id: number }> }
type FirstEntryPromptsPayload = Omit<RoomFirstEntryPromptsPayload, "room_prompt" | "effective_room_prompt"> & {
  room_prompt: string | null
  effective_room_prompt: string
}
type RoomSlideMenuPayload = {
  rooms: SlideMenuRoom[]
  currentRoom: (SlideMenuRoom & { notes: SlideMenuPage[] }) | null
}
type NotePayload = Omit<PagePayload, "room_id" | "parent_id" | "version"> & {
  room_id: number | null
  parent_id: number | null
  version: number | null
}
type NoteTreePayload = { room_id: number; notes: PageTreeNode[] }
type NotificationPreferenceItem = Awaited<ReturnType<NotificationPreferencesService["listForUser"]>>["items"][number]
type RoomNotificationPreferenceItem = {
  room_id: number
  room_name: string | null
  room_avatar_url: string | null
  notification_type: NotificationPreferenceItem["notification_type"]
}

export function serializeRoom(payload: RoomPayload): RoomPayload {
  return {
    id: payload.id,
    name: payload.name ?? null,
    avatar_url: payload.avatar_url ?? null,
    owner_id: payload.owner_id ?? null,
    canManage: payload.canManage ?? false,
    porosity: payload.porosity ?? "open",
    porosity_label: payload.porosity_label ?? "Open",
    parent: payload.parent ?? null,
    membership_state: payload.membership_state ?? "none",
    access: payload.access,
    viewer_invitation: payload.viewer_invitation ?? null,
    replySettings: payload.replySettings,
  }
}

export function serializeRoomMembers(payload: { members: RoomMemberPayload[] }, roomId: number): RoomMembersPayload {
  return {
    members: payload.members.map((member) => ({
      ...member,
      room_id: roomId,
    })),
  }
}

export function serializeFirstEntryPrompts(payload: RoomFirstEntryPromptsPayload): FirstEntryPromptsPayload {
  return {
    default_prompt: payload.default_prompt,
    room_prompt: payload.room_prompt ?? null,
    effective_room_prompt: payload.effective_room_prompt,
    members: payload.members,
  }
}

export function serializeSlideMenu(payload: SlideMenuPayload): RoomSlideMenuPayload {
  const currentRoom = payload.currentRoom
  return {
    rooms: payload.rooms.map(serializeSlideMenuRoom),
    currentRoom: currentRoom
      ? {
          ...serializeSlideMenuRoom(currentRoom),
          notes: currentRoom.pages.map(serializeSlideMenuNote),
        }
      : null,
  }
}

export function serializeNotePayload(payload: PagePayload | { page: PagePayload }): { note: NotePayload } {
  const note = "page" in payload ? payload.page : payload
  return { note: serializeNote(note) }
}

export function serializeNoteTree(payload: PageTreePayload): NoteTreePayload {
  return {
    room_id: payload.room_id,
    notes: payload.pages.map(serializeNoteTreeNode),
  }
}

export function serializeNotificationPreferenceItem(payload: NotificationPreferenceItem): RoomNotificationPreferenceItem {
  return {
    room_id: payload.room_id,
    room_name: payload.room_name ?? null,
    room_avatar_url: payload.room_avatar_url ?? null,
    notification_type: notificationTypeToApi(payload.notification_type),
  }
}

export function serializeNotificationPreferences(
  payload: { items: NotificationPreferenceItem[] },
): { items: RoomNotificationPreferenceItem[] } {
  return { items: payload.items.map(serializeNotificationPreferenceItem) }
}

function serializeNote(note: PagePayload): NotePayload {
  return {
    id: note.id,
    title: note.title ?? null,
    icon: note.icon ?? null,
    room_id: note.room_id ?? null,
    parent_id: note.parent_id ?? null,
    content: note.content,
    version: note.version ?? null,
    can_manage: note.can_manage,
  }
}

function serializeNoteTreeNode(note: PageTreeNode): PageTreeNode {
  return {
    id: note.id,
    title: note.title ?? null,
    icon: note.icon ?? null,
    parent_id: note.parent_id ?? null,
    updated_at: note.updated_at ?? null,
    children: note.children.map(serializeNoteTreeNode),
  }
}

function serializeSlideMenuRoom(circle: SlideMenuRoom): SlideMenuRoom {
  return {
    id: circle.id,
    name: circle.name ?? null,
    owner_id: circle.owner_id ?? null,
    canManage: circle.canManage ?? false,
    avatar_url: circle.avatar_url ?? null,
    porosity: circle.porosity ?? "open",
  }
}

function serializeSlideMenuNote(note: SlideMenuPage): SlideMenuPage {
  return {
    id: note.id,
    title: note.title ?? null,
    icon: note.icon ?? null,
  }
}
