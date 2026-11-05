import { useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import {
  fetchRoom,
  fetchRoomMembers,
  fetchRoomJoinRequests,
  fetchRoomKnocks,
  fetchRoomNotificationDeliveries,
  fetchRoomFirstEntryPrompts,
  updateRoomFirstEntryPrompts,
  updateRoomJoinRequest,
  updateRoomKnock,
  deleteRoomMember,
  deleteRoom,
  roomFormData,
  updateRoomRecord,
  type UpdateRoomFirstEntryPromptsPayload,
} from "../lib/api/rooms";
import { fetchMemberships } from "../lib/api/profile";
import { updateRoomFeedbackSettings } from "../lib/api/rooms";
import type { RoomReplySettings } from "../lib/feedback";
import { assertImageFile } from "../lib/imageFile";
import { appendPickedFile } from "../lib/chatFiles";
import type { ChatAttachment } from "../lib/chatComposition";
import { client } from "../lib/api";

export function useManagedRoom(id: string) {
  const roomDetails = useSWR(
    id ? ["managed-room", id] : null,
    () => fetchRoom(client, id),
    { refreshInterval: 15000 },
  );
  const identity = useSWR("memberships", () => fetchMemberships(client));
  const allowed = !roomDetails.error && roomDetails.data?.access?.can_manage === true;
  const host =
    allowed &&
    !identity.error &&
    identity.data?.user.id === roomDetails.data?.owner_id;
  return { room: roomDetails, identity, allowed, host };
}
type Action =
  | {
      kind: "identity";
      name: string;
      avatar?: ChatAttachment;
      removeAvatar: boolean;
    }
  | { kind: "reply"; settings: RoomReplySettings }
  | { kind: "remove-member"; membership: number }
  | { kind: "remove-room" }
  | {
      kind: "join";
      request: number;
      status: "approved" | "declined" | "pending";
    }
  | { kind: "knock"; request: number; status: "admitted" | "declined" }
  | { kind: "prompts"; payload: UpdateRoomFirstEntryPromptsPayload };
export function useRoomManagement(id: string) {
  const access = useManagedRoom(id);
  const { allowed, host } = access;
  const members = useSWR(allowed ? ["managed-room-members", id] : null, () =>
    fetchRoomMembers(client, id),
  );
  const joins = useSWR(allowed ? ["managed-room-joins", id] : null, () =>
    fetchRoomJoinRequests(client, id),
  );
  const knocks = useSWR(allowed ? ["managed-room-knocks", id] : null, () =>
    fetchRoomKnocks(client, id),
  );
  const deliveries = useSWR(host ? ["managed-room-deliveries", id] : null, () =>
    fetchRoomNotificationDeliveries(client, id),
  );
  const prompts = useSWR(host ? ["managed-room-prompts", id] : null, () =>
    fetchRoomFirstEntryPrompts(client, id),
  );
  const { mutate } = useSWRConfig();
  const flight = useRef<Promise<void> | null>(null);
  const mutation = useSWRMutation(
    ["manage-room", id],
    async (_, { arg }: { arg: Action }) => {
      if (!allowed)
        throw new Error("You no longer have permission to manage this Room.");
      if (
        ["remove-member", "remove-room", "prompts"].includes(arg.kind) &&
        !host
      )
        throw new Error("Only the Room host can do this.");
      switch (arg.kind) {
        case "identity": {
          const form = roomFormData({
            name: arg.name.trim(),
            remove_avatar: arg.removeAvatar,
          });
          if (arg.avatar) {
            assertImageFile(arg.avatar);
            appendPickedFile(form, "room[avatar]", arg.avatar);
          }
          await updateRoomRecord(client, id, form);
          break;
        }
        case "reply":
          await updateRoomFeedbackSettings(client, id, arg.settings);
          break;
        case "remove-member":
          await deleteRoomMember(client, id, arg.membership);
          break;
        case "remove-room":
          await deleteRoom(client, id);
          break;
        case "join":
          await updateRoomJoinRequest(client, id, arg.request, arg.status);
          break;
        case "knock":
          await updateRoomKnock(client, id, arg.request, arg.status);
          break;
        case "prompts":
          await updateRoomFirstEntryPrompts(client, id, arg.payload);
          break;
      }
      // Revalidate all adapters to the same Room, including a retained Chat screen.
      await mutate(
        (key) =>
          Array.isArray(key) &&
          ((arg.kind === "reply" && key[0] === "board") ||
            key.some((value) => String(value) === id)),
      ).catch(() => {});
      void mutate(
        (key) => key === "rooms" || (Array.isArray(key) && key[0] === "home"),
      ).catch(() => {});
    },
  );
  return {
    ...access,
    members,
    joins,
    knocks,
    deliveries,
    prompts,
    busy: mutation.isMutating,
    run(arg: Action) {
      if (flight.current) return flight.current;
      const result = mutation
        .trigger(arg)
        .then(() => {})
        .finally(() => {
          flight.current = null;
        });
      flight.current = result;
      return result;
    },
  };
}
